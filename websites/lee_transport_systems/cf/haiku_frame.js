import { base64FromArrayBuffer } from "./base64.js";

// Forces Claude's response into this exact shape (Anthropic structured outputs), so no
// JSON parsing/repair code is needed below. Flat list of rows, not pre-paired trips —
// pairing happens in JS (structure.js) since letting the model pair rows itself has
// produced mismatched results before.
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

// Field descriptions above cover most of it; prompt only adds what isn't obvious from
// names alone: use the nearest "Trip:" header, not the "Seq #" column, skip untagged
// dispatch-note rows, and this is transcription only — pairing happens in structure.js.
const EXTRACTION_PROMPT = `This is a photo of a LEETRANSSYSTEMS "Driver Summary Report". Extract the rows.

List one entry per row that is explicitly tagged "LLD" or "LUL" in the left margin, in the order they appear on the page. For each one, record which "Trip: N" header is printed directly above that row — not the small "Seq #" number printed to the left of the row, which is just a row counter and does not indicate which trip a row belongs to — along with whether the row itself is tagged "LLD" or "LUL", and that row's own order number, name, and address.

Do not create an entry for a row with no "LLD"/"LUL" tag — a Trip block can contain a dispatch note for the driver (e.g. a bare product/quantity line like "2500 DIESEL") that is not an address and must be skipped entirely. Do not try to match or pair rows with each other — just report each tagged row's own trip number, type, and fields exactly as printed on that row; nothing else needs to be inferred.`;

export async function handleOcr(request, env) {
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
