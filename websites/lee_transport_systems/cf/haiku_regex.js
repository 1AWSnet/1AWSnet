import { base64FromArrayBuffer } from "./base64.js";

// Plain transcription with no schema, to study Haiku's natural reading order across
// real photos via the haiku_regex sandbox before deciding if a regex-only parser can
// replace EXTRACTION_SCHEMA in haiku_frame.js. Separate route on purpose, so
// /api/ocr-frame itself is untouched.
const RAW_TRANSCRIPTION_PROMPT = `Transcribe every piece of text visible in this photo, exactly as printed. If the photo itself is rotated or sideways, read the text as if it were upright — transcribe what the text says, not how the photo is oriented.

Scan the page like a raster scan: start at the top-left corner, read across to the right, then move down to the next line and read left to right again, continuing top to bottom until you reach the bottom-right corner. Follow this strict top-to-bottom, left-to-right order regardless of columns, tables, boxes, or how the content is visually grouped — do not reorder text by meaning, category, or relationship between fields.

Transcribe every distinct piece of text you see, including short codes, abbreviations, and acronyms as short as two or three letters, even if they appear isolated, small, faint, stamped, or repeated elsewhere on the page. Never omit, merge, or paraphrase any text based on your own judgment of what is important — every printed character group must appear in your output exactly as printed.

This document uses two specific three-letter tags — "LLD" and "LUL" — that always appear immediately after a row's sequence number, right before a terminal or consignee name. These tags are critical and must never be omitted, even when the surrounding row is crowded with handwriting, close to a table border, or otherwise hard to read. If you can identify the row's sequence number and terminal name, the tag is present on that same line — actively look for it and include it exactly as printed.

Output only the raw transcribed text, as plain running text, in the order described above. Do not add extra spaces, indentation, or blank lines to represent where words are positioned on the page — use only normal single spaces and line breaks, the same as you would to write out what the page says as continuous text. No commentary, no markdown, no JSON, no labels or structure beyond what's already printed on the page itself.`;

// This prompt was working 99.99% correct. The issue was that it was sometimes dropping the "LUL" tag.
// const RAW_TRANSCRIPTION_PROMPT = `Transcribe every piece of text visible in this photo, exactly as printed. If the photo itself is rotated or sideways, read the text as if it were upright — describe what the text says, not how the photo is oriented.

// Output only the raw transcribed text, in the order you read it off the page, as plain running text. Do not add extra spaces, indentation, or blank lines to represent where words are positioned on the page — use only normal single spaces and line breaks, the same as you would to write out what the page says as continuous text. No commentary, no markdown, no JSON, no labels or structure beyond what's already printed on the page itself.`;

export async function handleOcrRaw(request, env) {
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
      temperature: 0,
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
