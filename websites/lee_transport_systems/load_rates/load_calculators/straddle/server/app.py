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
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from paddleocr import PaddleOCR

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

# Built once at startup -- the pipeline loads several model weights the first time it
# runs, so constructing it per-request would repeat that on every photo. Orientation
# classification and unwarping stay on: phone photos are routinely tilted or shot at an
# angle, and this is the same preprocessing PP-StructureV3 was already doing.
pipeline = PaddleOCR(use_doc_orientation_classify=True, use_doc_unwarping=True, use_textline_orientation=True)


@app.post("/structure")
async def structure(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_dir_path = Path(tmp_dir)
        suffix = Path(file.filename or "photo.jpg").suffix or ".jpg"
        image_path = tmp_dir_path / f"input{suffix}"
        image_path.write_bytes(await file.read())

        output_dir = tmp_dir_path / "output"
        for res in pipeline.predict(input=str(image_path)):
            res.save_to_json(save_path=str(output_dir))

        pages = [json.loads(p.read_text()) for p in sorted(output_dir.glob("*.json"))]
        return {"pages": [{"lines": page["rec_texts"]} for page in pages]}
