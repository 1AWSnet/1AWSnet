// Worker entry point for the whole lee-transport-systems site (see ../../wrangler.toml).
// Handles POST /api/ocr; every other request falls through automatically to the
// static assets configured in wrangler.toml — this script never needs to serve them.
//
// Extracts structured trip data from a photo of a LEETRANSSYSTEMS "Driver Summary
// Report" via Claude Haiku 4.5 vision. ANTHROPIC_API_KEY is a Cloudflare secret —
// never committed to this repo, never sent to the browser.

// Constrains Claude's response to exactly this shape (Anthropic's structured-output
// feature) — the API guarantees the match, so no JSON parsing/repair code is needed
// anywhere below.
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string", description: "Date from the 'PM Shift' header, as printed" },
    driverName: { type: "string", description: "Driver name from the 'Driver:' field" },
    trips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tripNumber: { type: "string", description: "The number from the 'Trip:' field" },
          orderNumber: { type: "string", description: "The number from the 'Order #:' field" },
          lldName: { type: "string", description: "Name of the LLD (pickup terminal)" },
          lldAddress: { type: "string", description: "Full address line printed under the LLD" },
          lulName: { type: "string", description: "Name of the LUL (delivery consignee)" },
          lulAddress: { type: "string", description: "Full address line printed under the LUL" },
        },
        required: ["tripNumber", "orderNumber", "lldName", "lldAddress", "lulName", "lulAddress"],
        additionalProperties: false,
      },
    },
  },
  required: ["date", "driverName", "trips"],
  additionalProperties: false,
};

// The schema's per-field descriptions above already explain most of what to extract —
// this only needs to cover the four things that aren't obvious from field names alone:
// how an LLD row and a LUL row pair up into a single trip, which number on the page
// actually identifies that trip (the "Seq #" column resets/overlaps per row and is not
// the trip number, which has caused mismatched LLD/LUL pairings in the past), that
// a Trip block can contain a leading dispatch-note row with no LLD/LUL tag (e.g. a plain
// commodity/quantity line like "2500 DIESEL") that must not be mistaken for the LLD row —
// it isn't for the driver, not an address, and has been misread as the origin before —
// and that the same LLD terminal can legitimately be the pickup for more than one Trip
// block (one load, multiple drops), which has caused its address to also get echoed
// into the LUL fields of that trip instead of the actual, different delivery address.
const EXTRACTION_PROMPT = `This is a photo of a LEETRANSSYSTEMS "Driver Summary Report". Extract the trip data.

Each "Trip" block is delimited by a "Trip: N" header row and contains one LLD row (the pickup terminal) and one LUL row (the delivery consignee) — pair them together as a single trip using that "Trip: N" header, not the small "Seq #" number printed to the left of each row. The Seq # is just a row counter and does not indicate which trip a row belongs to — ignore it entirely. Multiple product/quantity lines under one LLD/LUL do not create extra trips; one Trip block is one trip.

Only use rows explicitly tagged "LLD" or "LUL" in the left margin as the pickup/delivery rows. A Trip block may contain an extra row with no "LLD"/"LUL" tag — this is a dispatch note for the driver (e.g. a bare product/quantity line like "2500 DIESEL"), not an address, and must be ignored entirely. Never use text from an untagged row as lldName, lldAddress, lulName, or lulAddress — those four fields must come only from the row explicitly tagged "LLD" and the row explicitly tagged "LUL" within that same Trip block.

The same LLD terminal name and address can appear on the page more than once, as the pickup for two or more separate Trip blocks — that is normal, not an error. When this happens, do not let the repeated LLD text leak into a nearby trip's LUL fields. lulName and lulAddress must always be transcribed from the row explicitly tagged "LUL" inside that same Trip block, even when it is visually close to, or shares a city with, an LLD row from a different trip.`;

// Claude's API only accepts images as base64 text inside the JSON request body, not
// raw binary — this converts the uploaded photo's bytes into that format. Chunked
// because spreading a large image's bytes into String.fromCharCode() all at once can
// exceed the JS engine's max function-argument limit.
function base64FromArrayBuffer(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function handleOcr(request, env) {
  // Fails fast with a clear message instead of letting Anthropic's own auth error
  // (still caught below regardless) be the first sign something's misconfigured.
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "Server is not configured with an API key." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rejects an obviously-wrong upload before spending an API call on it.
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return new Response(JSON.stringify({ error: "Expected an image upload (Content-Type: image/*)." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const imageBuffer = await request.arrayBuffer();
  const base64Image = base64FromArrayBuffer(imageBuffer);

  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Read from the Cloudflare secret at request time — only readable here, at
      // runtime, never present in this file or sent to the browser.
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: contentType, data: base64Image } },
            { type: "text", text: EXTRACTION_PROMPT },
          ],
        },
      ],
      // Ties the request to EXTRACTION_SCHEMA above — this is what actually turns on
      // the structured-output guarantee.
      output_config: {
        format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
      },
    }),
  });

  // Forwards Anthropic's own error message (e.g. low credit balance, bad key) instead
  // of a generic failure, since the specific cause is only knowable from that message.
  if (!anthropicResponse.ok) {
    const errorBody = await anthropicResponse.text();
    return new Response(JSON.stringify({ error: "Claude API request failed", detail: errorBody }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await anthropicResponse.json();
  // Claude's response is a list of content blocks (could include other types, like
  // tool calls, in general) — the schema-shaped JSON is always the text block.
  const textBlock = result.content?.find((block) => block.type === "text");

  if (!textBlock) {
    return new Response(JSON.stringify({ error: "No text content in Claude's response", raw: result }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(textBlock.text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // This script is the entry point for the whole site's Worker, not just this
    // feature — everything except /api/ocr falls through automatically to static
    // asset serving (configured in wrangler.toml), so no other routing belongs here.
    if (url.pathname === "/api/ocr" && request.method === "POST") {
      return handleOcr(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
