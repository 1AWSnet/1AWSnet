import { handleOcr } from "./haiku_frame.js";
import { handleStraddle } from "./straddle.js";

// Worker entry point for the lee-transport-systems site. Routes POST /api/ocr-frame
// and /api/straddle-ocr; everything else falls through to static assets
// (see ./wrangler.toml). ANTHROPIC_API_KEY, STRADDLE_OCR_URL and STRADDLE_OCR_SECRET are
// Cloudflare secrets — never in this repo, never sent to the browser.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Everything except these /api routes falls through to static asset serving
    // (configured in wrangler.toml) — no other routing belongs here.
    if (url.pathname === "/api/ocr-frame" && request.method === "POST") {
      return handleOcr(request, env);
    }

    // GPU PaddleOCR box over a Cloudflare Tunnel, with Haiku as the fallback — see
    // straddle.js for why the two return different shapes.
    if (url.pathname === "/api/straddle-ocr" && request.method === "POST") {
      return handleStraddle(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
