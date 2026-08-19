import { handleOcr } from "./haiku_frame.js";
import { handleOcrRaw } from "./haiku_regex.js";

// Worker entry point for the lee-transport-systems site. Routes POST /api/ocr-frame and
// /api/ocr-regex; everything else falls through to static assets (see ./wrangler.toml).
// ANTHROPIC_API_KEY is a Cloudflare secret — never in this repo, never sent to the browser.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Everything except /api/ocr-frame and /api/ocr-regex falls through to static asset
    // serving (configured in wrangler.toml) — no other routing belongs here.
    if (url.pathname === "/api/ocr-frame" && request.method === "POST") {
      return handleOcr(request, env);
    }

    if (url.pathname === "/api/ocr-regex" && request.method === "POST") {
      return handleOcrRaw(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};
