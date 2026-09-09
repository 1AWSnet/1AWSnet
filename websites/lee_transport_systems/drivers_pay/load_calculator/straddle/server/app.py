# OCR service for the Straddle calculator (../index.html + ../js/upload.js).
#
# Runs separately from the Cloudflare deploy: this needs Python + paddlepaddle on a GPU,
# which the Worker (../../../../cf/) can't run -- that's a JS-only edge runtime. In
# production the browser POSTs to the Worker route /api/straddle-ocr (cf/straddle.js),
# which forwards the image here over a Cloudflare Tunnel with an X-Straddle-Secret header,
# and falls back to Haiku if this box doesn't answer. Run it with:
#   pip install -r requirements.txt          # plus the GPU paddlepaddle wheel -- see that file
#   STRADDLE_OCR_SECRET=... uvicorn app:app --host 127.0.0.1 --port 8000
# The secret is optional for LAN dev (the header check is skipped when it's unset).
#
# Uses the plain PaddleOCR pipeline (detection + recognition only), not PP-StructureV3 --
# PP-StructureV3's layout-detection step first decides which regions of the page are
# worth reading, and on a photo with an unusually large gap between the trip table and
# the totals section (few trips, lots of blank space), its "table" region stopped partway
# down the page and everything below it -- Start/End/Total Mileage, Total Fuel, the whole
# totals line -- fell outside any detected region and was silently never read at all.
# Plain PaddleOCR has no such gating: it just reads text everywhere on the page, so
# there's no region boundary for real content to fall outside of. We only ever used
# PP-StructureV3 for its recognized text anyway (never its layout/table-structure
# output), so nothing downstream depended on the layout step in the first place.
#
# Returns just the recognized text lines (rec_texts), not the full result -- the rest
# (pixel-coordinate boxes for every line, per-line confidence scores, doc-preprocessing
# metadata) is real data but not something a person needs to read, and dwarfs the actual
# text in size. Downstream parsing (trip/LLD/LUL extraction) lives in
# ../js/parse-rec-texts.js, on the client side -- this endpoint only ever hands back the
# raw line list.

import json
import logging
import os
import tempfile
from pathlib import Path

# Must be set before paddleocr/paddlex is imported -- this flag is read once at import
# time, not re-checked later. Benchmarked on this machine (8-core/16-thread CPU) against
# the same real photo: 4 threads measured the same speed as 8/10(default)/16 (18.6-19.1s,
# no real difference), while 1-2 threads measured a real ~13-15% slower (21.6-21.9s). So 4
# is the lowest thread count with no speed cost -- lower leaves less CPU available for
# everything else running on the machine at the same time, for free.
os.environ.setdefault("PADDLE_PDX_CPU_NUM_THREADS", "4")

import cv2
import numpy as np
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR

# Set in production (the Cloudflare Worker sends the matching X-Straddle-Secret header);
# left unset for LAN dev, where the check below is skipped. Gates the pipeline so a
# request that reaches the tunnel hostname directly can't drive it without the secret.
STRADDLE_SECRET = os.environ.get("STRADDLE_OCR_SECRET")

# Downscaling AND adaptive-threshold binarization both happen in the browser now
# (js/dom-helpers.js's preprocessImage) -- once the box moved behind a Cloudflare Tunnel,
# shipping the full photo here just to shrink it was most of the round trip. A normal
# upload arrives already <=MAX_LONG_SIDE and black-on-white and is written to disk
# unchanged. This value is kept in sync with dom-helpers.js: it started at 1500 but that
# lost thin strokes on real photos once the sharp server-side Lanczos downscale was gone,
# so both sides went to 2000.
MAX_LONG_SIDE = 2000

# A downscaled, binarized PNG from the page is comfortably under this. Anything bigger
# didn't come from preprocessImage (a direct API call, or the page's JS failing), so
# it's worth a decode to check the dimensions.
GUARD_MAX_BYTES = 1_500_000


# Backstop only: shrink an oversized image so it can't waste GPU memory, but never
# binarize -- running adaptive threshold on an already-binary image eats thin strokes.
def guard_downscale(image_bytes: bytes) -> bytes:
    if len(image_bytes) < GUARD_MAX_BYTES:
        return image_bytes

    array = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("uploaded bytes are not a decodable image")

    long_side = max(img.shape[:2])
    if long_side <= MAX_LONG_SIDE:
        return image_bytes

    scale = MAX_LONG_SIDE / long_side
    new_size = (round(img.shape[1] * scale), round(img.shape[0] * scale))
    img = cv2.resize(img, new_size, interpolation=cv2.INTER_AREA)
    ok, encoded = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("failed to re-encode oversized image")
    return encoded.tobytes()

app = FastAPI()

# Wide open for local dev: this only ever runs on localhost, and the page calling it
# could be served from any origin. Tighten this before ever exposing it beyond your
# own machine.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# CORSMiddleware only attaches its headers to responses that complete normally through
# FastAPI's own exception handling -- an exception that escapes uncaught (e.g. a crash
# inside the pipeline) skips past it entirely, so the browser sees a response with no
# CORS headers at all and reports a generic "NetworkError" instead of the real failure.
# Routing every exception through a registered handler keeps it inside that normal path.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"error": str(exc)})

logger = logging.getLogger("uvicorn.error")


def build_pipeline(device: str) -> PaddleOCR:
    # Built once at startup -- the pipeline loads several model weights the first time it
    # runs, so constructing it per-request would repeat that on every photo. Orientation
    # classification and unwarping stay on: phone photos are routinely tilted or shot at
    # an angle, and this is the same preprocessing PP-StructureV3 was already doing.
    return PaddleOCR(
        use_doc_orientation_classify=True,
        use_doc_unwarping=True,
        use_textline_orientation=True,
        device=device,
    )


# GPU is primary, CPU is the fallback. On this machine's RTX 3050 the OCR predict runs
# ~5x faster than CPU (~2s vs ~10s warm), but the GPU path can be unavailable for a
# whole range of reasons that all surface the same way at startup -- no NVIDIA driver
# loaded (e.g. after a kernel update, before the akmods rebuild + reboot), a CPU-only
# paddlepaddle wheel installed, a CUDA/driver version mismatch -- so this catches broadly
# rather than trying to enumerate them, logs which device it landed on, and keeps serving
# on CPU either way.
try:
    import paddle

    if paddle.device.cuda.device_count() < 1:
        raise RuntimeError("no CUDA device visible to paddle")
    pipeline = build_pipeline("gpu")
    active_device = "gpu"
except Exception as exc:
    logger.warning("GPU OCR unavailable (%s); falling back to CPU", exc)
    pipeline = build_pipeline("cpu")
    active_device = "cpu"

logger.info("Straddle OCR pipeline ready on %s", active_device)

# Only built if a GPU predict actually fails mid-request -- normal GPU operation never
# pays the memory/startup cost of a second copy of the models. Already the CPU pipeline
# itself when startup fell back, so the retry path is a no-op reuse in that case.
cpu_fallback = pipeline if active_device == "cpu" else None


def run_pipeline(image_path: Path):
    global cpu_fallback
    try:
        return list(pipeline.predict(input=str(image_path)))
    except Exception as exc:
        if active_device != "gpu":
            raise
        # A GPU run that dies after startup -- most likely CUDA OOM on a dense page, this
        # card only has 4GB -- shouldn't fail the request when CPU can still read it.
        logger.warning("GPU predict failed (%s); retrying this scan on CPU", exc)
        if cpu_fallback is None:
            cpu_fallback = build_pipeline("cpu")
        return list(cpu_fallback.predict(input=str(image_path)))


@app.post("/structure")
async def structure(request: Request):
    if STRADDLE_SECRET and request.headers.get("x-straddle-secret") != STRADDLE_SECRET:
        return JSONResponse(status_code=401, content={"error": "missing or bad X-Straddle-Secret"})

    # Raw image bytes as the request body (Content-Type: image/*), not multipart form
    # data -- the Worker forwards exactly what the browser sent it, which is the
    # already-downscaled, binarized PNG from js/dom-helpers.js's preprocessImage.
    body = await request.body()

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        # .png to match what the page sends; guard_downscale is a no-op passthrough for
        # it and only re-encodes (also as PNG) if some oversized image slipped through.
        image_path = tmp_dir_path / "input.png"
        image_path.write_bytes(guard_downscale(body))

        output_dir = tmp_dir_path / "output"
        for res in run_pipeline(image_path):
            res.save_to_json(save_path=str(output_dir))

        pages = [json.loads(p.read_text()) for p in sorted(output_dir.glob("*.json"))]
        return {"pages": [{"lines": page["rec_texts"]} for page in pages]}
