# Local PP-StructureV3 service for the Straddle sandbox (../index.html + ../upload.js).
#
# Not part of the Cloudflare deploy: PP-StructureV3 needs Python + paddlepaddle, which
# the Cloudflare Worker (../../../../cf/) can't run -- that's a JS-only edge runtime.
# Run this separately:
#   pip install -r requirements.txt
#   uvicorn app:app --host 0.0.0.0 --port 8000
# then point ../upload.js's STRADDLE_ENDPOINT at wherever it ends up reachable.
#
# Returns just the recognized text lines (overall_ocr_res.rec_texts), not PP-StructureV3's
# full result -- the rest (pixel-coordinate boxes for every line, per-line confidence
# scores, table-structure HTML, doc-preprocessing metadata) is real data but not
# something a person needs to read, and dwarfs the actual text in size. Downstream
# parsing (trip/LLD/LUL extraction) lives in ../parse-rec-texts.js, on the client side --
# this endpoint only ever hands back the raw line list.

import json
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from paddleocr import PPStructureV3

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

# Built once at startup -- PP-StructureV3 loads several model weights the first time
# it runs, so constructing it per-request would repeat that on every photo.
pipeline = PPStructureV3()


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
        return {"pages": [{"lines": page["overall_ocr_res"]["rec_texts"]} for page in pages]}
