// Worker entry point for the whole lee-transport-systems site (see ../../wrangler.toml).
// Handles POST /api/ocr; every other request falls through automatically to the
// static assets configured in wrangler.toml — this script never needs to serve them.
//
// Extracts structured trip data from a photo of a LEETRANSSYSTEMS "Driver Summary
// Report" via Claude Haiku 4.5 vision. ANTHROPIC_API_KEY is a Cloudflare secret —
// never committed to this repo, never sent to the browser.

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    driver: { type: "string", description: "Driver name from the 'Driver:' field" },
    shiftDate: { type: "string", description: "Date from the 'PM Shift' header, as printed" },
    trips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          orderNumber: { type: "string", description: "The Order # for this trip" },
          originTerminal: { type: "string", description: "Name of the LLD (loading terminal)" },
          originLocation: { type: "string", description: "City, ST from the LLD address line" },
          destinationName: { type: "string", description: "Name of the LUL (consignee)" },
          destinationLocation: { type: "string", description: "City, ST from the LUL address line" },
        },
        required: ["orderNumber", "originTerminal", "originLocation", "destinationName", "destinationLocation"],
        additionalProperties: false,
      },
    },
    startMileage: { type: "string", description: "Handwritten Start Mileage value, if present" },
    totalFuel: { type: "string", description: "Handwritten Total Fuel value, if present" },
  },
  required: ["driver", "shiftDate", "trips", "startMileage", "totalFuel"],
  additionalProperties: false,
};

const EXTRACTION_PROMPT = `This is a photo of a LEETRANSSYSTEMS "Driver Summary Report". Extract the trip data.

Each "Trip" block has one LLD row (the loading terminal — its address line ends in an origin city/state) and one LUL row (the consignee — its address line ends in a destination city/state). Multiple product/quantity lines under one LLD/LUL do not create extra trips — one Trip block is one trip.

Give each city/state as it's printed, in "City, ST" format.`;

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
      output_config: {
        format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
      },
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
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/ocr" && request.method === "POST") {
      return handleOcr(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
