# Local OCR service for the Straddle sandbox (../index.html + ../js/upload.js).
#
# Not part of the Cloudflare deploy: this needs Python + paddlepaddle, which the
# Cloudflare Worker (../../../../cf/) can't run -- that's a JS-only edge runtime.
# Run this separately:
#   pip install -r requirements.txt
#   uvicorn app:app --host 0.0.0.0 --port 8000
# then point ../js/upload.js's STRADDLE_ENDPOINT at wherever it ends up reachable.
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
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR

# Longest side to downscale a photo to before it ever reaches the pipeline. Benchmarked
# against a real Driver Summary Report photo (3024x4032 native): downscaling to 1500px
# cut pipeline time from ~22s to ~8s with zero loss of any real page content: every
# terminal name, delivery address, and the Start/End/Total Mileage section still came
# through correctly. 700px was tested and found to be too aggressive -- the mileage
# totals section started dropping out entirely. 1500px has only been validated on one
# relatively clean photo, not yet against denser/harder ones (heavy handwriting, crowded
# rows) -- keep an eye on those specifically until that's confirmed too.
MAX_LONG_SIDE = 1500


# Binarizing (adaptive threshold, not a flat cutoff -- handles uneven lighting across the
# page better than a single global threshold would) at this same resolution shaves off
# roughly another 13% of file size for the same speed and same accuracy, benchmarked
# against the same photo. Doing it at a HIGHER resolution instead of downscaling doesn't
# help -- that was tested too and comes out both bigger and slower than just downscaling
# to MAX_LONG_SIDE directly, so this always runs after the resize, never as a substitute
# for it.
def preprocess_image(image_bytes: bytes) -> bytes:
    array = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(array, cv2.IMREAD_COLOR)

    long_side = max(img.shape[:2])
    if long_side > MAX_LONG_SIDE:
        scale = MAX_LONG_SIDE / long_side
        new_size = (round(img.shape[1] * scale), round(img.shape[0] * scale))
        img = cv2.resize(img, new_size, interpolation=cv2.INTER_LANCZOS4)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    binarized = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 35, 15
    )

    ok, encoded = cv2.imencode(".jpg", binarized, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise ValueError("Failed to encode preprocessed image")
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
async def structure(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        # Always .jpg regardless of what was uploaded -- preprocess_image re-encodes
        # the (resized, binarized) result as JPEG itself, so the original extension no
        # longer describes what's actually being written here.
        image_path = tmp_dir_path / "input.jpg"
        image_path.write_bytes(preprocess_image(await file.read()))

        output_dir = tmp_dir_path / "output"
        for res in run_pipeline(image_path):
            res.save_to_json(save_path=str(output_dir))

        pages = [json.loads(p.read_text()) for p in sorted(output_dir.glob("*.json"))]
        return {"pages": [{"lines": page["rec_texts"]} for page in pages]}
