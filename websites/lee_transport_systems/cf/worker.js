// Worker entry point for the whole lee-transport-systems site (see ./wrangler.toml).
// Handles POST /api/ocr; every other request falls through automatically to the
// static assets configured in wrangler.toml — this script never needs to serve them.
//
// Extracts structured trip data from a photo of a LEETRANSSYSTEMS "Driver Summary
// Report" via Claude Haiku 4.5 vision. ANTHROPIC_API_KEY is a Cloudflare secret —
// never committed to this repo, never sent to the browser.

// Constrains Claude's response to exactly this shape (Anthropic's structured-output
// feature) — the API guarantees the match, so no JSON parsing/repair code is needed
// anywhere below.
//
// This is deliberately a flat list of rows, not a list of already-paired trips. Pairing
// an LLD row with the right LUL row for a given trip is a mechanical grouping task once
// each row's own trip number is known, and doing it in JS (see structure.js) makes it
// exact instead of leaving it to the model — asking Claude to both transcribe *and*
// correctly pair rows itself has repeatedly produced mismatched pairings (see git log
// for this file) when the page has repeated or visually similar text across trips.
// Each entry only has to answer questions a person could answer by looking at that one
// row in isolation: which Trip header is directly above it, and what's printed on it.
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string", description: "Date from the 'PM Shift' header, as printed" },
    driverName: { type: "string", description: "Driver name from the 'Driver:' field" },
    rows: {
      type: "array",
      description: "One entry per row explicitly tagged LLD or LUL in the left margin, in the order they appear on the page.",
      items: {
        type: "object",
        properties: {
          tripNumber: { type: "string", description: "The number from the 'Trip:' header printed directly above this row" },
          rowType: { type: "string", enum: ["LLD", "LUL"], description: "The tag ('LLD' or 'LUL') printed in the left margin next to this row" },
          orderNumber: { type: "string", description: "This row's own 'Order #:' value" },
          name: { type: "string", description: "The terminal/consignee name printed on this row" },
          address: { type: "string", description: "The full address line printed under the name on this row" },
        },
        required: ["tripNumber", "rowType", "orderNumber", "name", "address"],
        additionalProperties: false,
      },
    },
  },
  required: ["date", "driverName", "rows"],
  additionalProperties: false,
};

// The schema's per-field descriptions above already explain most of what to extract —
// this only needs to cover the three things that aren't obvious from field names alone:
// which number identifies a row's trip (the "Seq #" column resets/overlaps per row and
// is not the trip number — using it in place of the nearest "Trip:" header has caused
// mismatched pairings in the past), that a Trip block can contain a leading dispatch-note
// row with no LLD/LUL tag (e.g. a plain commodity/quantity line like "2500 DIESEL") that
// must be skipped rather than reported as a row, and that this is a transcription task,
// not a pairing task — Claude reports each tagged row on its own, and the grouping into
// trips happens afterward in code (structure.js), where it can't go wrong the way the
// model has before when a page had repeated or visually similar LLD/LUL text.
const EXTRACTION_PROMPT = `This is a photo of a LEETRANSSYSTEMS "Driver Summary Report". Extract the rows.

List one entry per row that is explicitly tagged "LLD" or "LUL" in the left margin, in the order they appear on the page. For each one, record which "Trip: N" header is printed directly above that row — not the small "Seq #" number printed to the left of the row, which is just a row counter and does not indicate which trip a row belongs to — along with whether the row itself is tagged "LLD" or "LUL", and that row's own order number, name, and address.

Do not create an entry for a row with no "LLD"/"LUL" tag — a Trip block can contain a dispatch note for the driver (e.g. a bare product/quantity line like "2500 DIESEL") that is not an address and must be skipped entirely. Do not try to match or pair rows with each other — just report each tagged row's own trip number, type, and fields exactly as printed on that row; nothing else needs to be inferred.`;

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

// Diagnostic-only prompt, not used by any page in normal operation. Asks Haiku to
// transcribe a photo with no schema and no instructions at all about trips, LLD/LUL,
// or structure — just whatever its own natural reading order produces, plus exactly
// two things: read the page upright regardless of how the photo itself is rotated
// (the client-side EXIF fix in normalizeOrientation() only corrects a phone's reported
// orientation, not a document photographed sideways on a physical page), and don't
// use extra spacing to recreate the page's visual layout — some photos were coming
// back with wide gaps simulating column position instead of plain running text, which
// isn't useful for a parser that's going to work off the text stream itself. Exists so
// that reading order can be collected across many real photos (via the haiku_regex
// sandbox page) and compared for consistency before deciding whether a parser built
// entirely out of our own regex, reading Haiku's raw text directly, can replace
// EXTRACTION_SCHEMA above. Deliberately kept as a separate function/route rather than
// merged into handleOcr, so nothing about the existing /api/ocr path is touched here.
const RAW_TRANSCRIPTION_PROMPT = `Transcribe every piece of text visible in this photo, exactly as printed. If the photo itself is rotated or sideways, read the text as if it were upright — describe what the text says, not how the photo is oriented.

Output only the raw transcribed text, in the order you read it off the page, as plain running text. Do not add extra spaces, indentation, or blank lines to represent where words are positioned on the page — use only normal single spaces and line breaks, the same as you would to write out what the page says as continuous text. No commentary, no markdown, no JSON, no labels or structure beyond what's already printed on the page itself.`;

async function handleOcrRaw(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "Server is not configured with an API key." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

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
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: contentType, data: base64Image } },
            { type: "text", text: RAW_TRANSCRIPTION_PROMPT },
          ],
        },
      ],
      // No output_config here — unlike handleOcr, this endpoint deliberately leaves
      // Haiku's response unconstrained so its natural reading order isn't shaped by a
      // schema at all.
    }),
  });

  if (!anthropicResponse.ok) {
    const errorBody = await anthropicResponse.text();
    return new Response(JSON.stringify({ error: "Claude API request failed", detail: errorBody }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = await anthropicResponse.json();
  const textBlock = result.content?.find((block) => block.type === "text");

  if (!textBlock) {
    return new Response(JSON.stringify({ error: "No text content in Claude's response", raw: result }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(textBlock.text, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // This script is the entry point for the whole site's Worker, not just this
    // feature — everything except /api/ocr and /api/ocr-raw falls through
    // automatically to static asset serving (configured in wrangler.toml), so no
    // other routing belongs here.
    if (url.pathname === "/api/ocr" && request.method === "POST") {
      return handleOcr(request, env);
    }

    if (url.pathname === "/api/ocr-raw" && request.method === "POST") {
      return handleOcrRaw(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
