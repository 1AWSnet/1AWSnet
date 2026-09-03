import { runHaikuOcr } from "./haiku_frame.js";

// Straddle OCR route (POST /api/straddle-ocr). Primary engine is a GPU PaddleOCR box
// (../load_rates/load_calculator/straddle/server/app.py) reached over a Cloudflare
// Tunnel; the fallback is Haiku (runHaikuOcr), used whenever that box is unreachable,
// too slow, or answers with an error. The two engines reply in different shapes on
// purpose:
//   - the tunnel returns app.py's raw   {"pages":[{"lines":[...]}]}
//   - Haiku returns the structured      {"date","driverName","rows":[...]}
// ../load_rates/load_calculator/straddle/js/parse-rec-texts.js turns the former into
// the latter in the browser, so both converge before structureOcrResult(). This handler
// only forwards -- it never rewrites the shape. The X-OCR-Engine response header says
// which engine actually answered ("cuda" or "haiku") so the page, and a person in
// devtools, can tell which path a given scan took.
//
// STRADDLE_OCR_URL is a plain var in wrangler.toml (just the public tunnel hostname);
// STRADDLE_OCR_SECRET is a Cloudflare dashboard secret, never committed. If either is
// missing every request goes straight to Haiku ("tunnel not configured") -- a safe
// default rather than an outage, e.g. before the secret has been set.

// The box does a full downscale + binarize + multi-model OCR pass per image; a warm GPU
// run is ~2-3s, so this is generous headroom for a cold run or a dense page while still
// bailing to Haiku well before a user gives up on the request.
const TUNNEL_TIMEOUT_MS = 20000;

function withEngine(response, engine, detail) {
  const headers = new Headers(response.headers);
  headers.set("X-OCR-Engine", engine);
  // Why the box was skipped, when it was -- handy in devtools, harmless to expose (it's
  // a status string like "tunnel responded 502" or "timeout", never anything secret).
  if (detail) headers.set("X-OCR-Fallback-Reason", String(detail).slice(0, 200));
  return new Response(response.body, { status: response.status, headers });
}

export async function handleStraddle(request, env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    return new Response(JSON.stringify({ error: "Expected an image upload (Content-Type: image/*)." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Read the body once -- a request body stream can only be consumed a single time, and
  // it's needed either for the tunnel or for the Haiku fallback.
  const imageBuffer = await request.arrayBuffer();

  if (!env.STRADDLE_OCR_URL || !env.STRADDLE_OCR_SECRET) {
    return withEngine(
      await runHaikuOcr(imageBuffer, contentType, env),
      "haiku",
      "tunnel not configured",
    );
  }

  try {
    const tunnelResponse = await fetch(env.STRADDLE_OCR_URL, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        "X-Straddle-Secret": env.STRADDLE_OCR_SECRET,
      },
      body: imageBuffer,
      signal: AbortSignal.timeout(TUNNEL_TIMEOUT_MS),
    });

    if (!tunnelResponse.ok) {
      throw new Error(`tunnel responded ${tunnelResponse.status}`);
    }

    // Buffer the whole JSON rather than streaming tunnelResponse.body straight through:
    // the page needs a complete, valid document to parse, so a mid-stream failure from
    // the box should become a clean Haiku fallback here, not a truncated body the
    // browser can't use.
    const text = await tunnelResponse.text();
    return withEngine(
      new Response(text, { status: 200, headers: { "Content-Type": "application/json" } }),
      "cuda",
    );
  } catch (err) {
    return withEngine(
      await runHaikuOcr(imageBuffer, contentType, env),
      "haiku",
      err && err.name === "TimeoutError" ? "timeout" : err && err.message ? err.message : err,
    );
  }
}
