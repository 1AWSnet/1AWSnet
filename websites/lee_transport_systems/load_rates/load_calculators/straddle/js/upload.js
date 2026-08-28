// Wires up straddle/index.html's upload flow. Depends on getOcrPageElements /
// wireFileInput / wireCopyButton / startUploadCounter / stopUploadCounter /
// normalizeOrientation (dom-helpers.js), parseRecTextsToRows (parse-rec-texts.js), and
// structureOcrResult / renderTrips (structure.js, render.js) -- all this folder's own
// forks, loaded before this script.
//
// POSTs the orientation-normalized image (raw body, Content-Type: image/*) to the
// Worker route /api/straddle-ocr (cf/straddle.js). That route forwards to a GPU
// PaddleOCR box over a Cloudflare Tunnel and falls back to Haiku when the box is down.
// The two engines answer in different shapes: the box returns {pages:[{lines:[...]}]},
// Haiku returns {date,driverName,rows:[...]}. callStraddle below normalizes both to the
// {date,driverName,rows} shape structureOcrResult() wants -- parseRecTextsToRows does
// that conversion for the box's raw lines, Haiku's response already is that shape.
const STRADDLE_ENDPOINT = '/api/straddle-ocr';

// Any of these appearing means the page's own bottom section (drivers' totals) was
// reached, so there's nothing more of this report on a further page.
const END_OF_PAGE_RE = /start mileage|end mileage|total mileage|total fuel/i;

const {
  fileInput, fileNameEl, statusEl, resultEl, rawDetails, previewDetails, normalizedPreview,
} = getOcrPageElements();

const continuationEl = document.getElementById('continuation');
const continuationYesBtn = document.getElementById('continuationYes');
const continuationNoBtn = document.getElementById('continuationNo');
const secondPageControls = document.getElementById('secondPageControls');
const secondPageInput = document.getElementById('secondPagePhoto');
const secondPageFileNameEl = document.getElementById('secondPageFileName');
const secondPageUploadBtn = document.getElementById('secondPageUpload');

wireCopyButton(document.getElementById('copyRaw'), resultEl);
wireFileInput(fileInput, fileNameEl, statusEl);
wireFileInput(secondPageInput, secondPageFileNameEl, statusEl);

// Accumulates across pages -- date/driver name come from whichever page had them
// (normally just the first), rows are the concatenation of every page uploaded so far.
let accumulatedRows = [];
let accumulatedDate = '';
let accumulatedDriverName = '';

// Returns { parsed, rawLines, engine }:
//   parsed   - always the {date, driverName, rows} shape structureOcrResult() consumes
//   rawLines - the OCR line list when the GPU box answered, else null (Haiku fallback,
//              which has no raw lines -- only structured rows)
//   engine   - 'cuda' | 'haiku' | 'unknown', from the X-OCR-Engine response header
async function callStraddle(file) {
  const normalized = await normalizeOrientation(file);
  normalizedPreview.src = URL.createObjectURL(normalized);
  previewDetails.style.display = 'block';

  const response = await fetch(STRADDLE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': normalized.type || 'image/jpeg' },
    body: normalized,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text);

  const data = JSON.parse(text);
  const engine = response.headers.get('X-OCR-Engine') || 'unknown';
  const rawLines = data.pages ? data.pages[0].lines : null;
  const parsed = rawLines ? parseRecTextsToRows(rawLines) : data;
  return { parsed, rawLines, engine };
}

function renderAccumulated() {
  renderTrips(structureOcrResult({
    date: accumulatedDate,
    driverName: accumulatedDriverName,
    rows: accumulatedRows,
  }));
}

document.getElementById('upload').addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) {
    statusEl.textContent = 'Photo has not been selected.';
    return;
  }

  startUploadCounter(statusEl);
  resultEl.textContent = '';
  rawDetails.style.display = 'none';
  continuationEl.style.display = 'none';
  secondPageControls.style.display = 'none';
  accumulatedRows = [];
  accumulatedDate = '';
  accumulatedDriverName = '';

  try {
    const { parsed, rawLines } = await callStraddle(file);
    stopUploadCounter();

    resultEl.textContent = rawLines
      ? JSON.stringify(rawLines, null, 2)
      : JSON.stringify(parsed, null, 2);
    rawDetails.style.display = 'block';

    accumulatedRows = parsed.rows;
    accumulatedDate = parsed.date;
    accumulatedDriverName = parsed.driverName;
    renderAccumulated();

    if (!rawLines) {
      // Haiku fallback: its schema only covers LLD/LUL rows, never the totals section,
      // so there's no way to tell whether the page was complete -- don't guess.
      statusEl.textContent = 'Done (Haiku fallback -- the OCR box was unreachable).';
    } else if (END_OF_PAGE_RE.test(rawLines.join(' '))) {
      statusEl.textContent = 'Done.';
    } else {
      statusEl.textContent = 'Done -- but this page doesn\'t look complete.';
      continuationEl.style.display = 'block';
    }
  } catch (err) {
    stopUploadCounter();
    statusEl.textContent = 'Request failed.';
    resultEl.textContent = String(err);
    rawDetails.style.display = 'block';
  }
});

continuationNoBtn.addEventListener('click', () => {
  continuationEl.style.display = 'none';
});

continuationYesBtn.addEventListener('click', () => {
  secondPageControls.style.display = 'block';
});

secondPageUploadBtn.addEventListener('click', async () => {
  const file = secondPageInput.files[0];
  if (!file) {
    statusEl.textContent = 'Second page photo has not been selected.';
    return;
  }

  startUploadCounter(statusEl);

  try {
    const { parsed, rawLines } = await callStraddle(file);
    stopUploadCounter();

    // Renumbers the second page's trips to continue after the first page's, rather
    // than colliding with them -- groupRowsIntoTrips (structure.js) groups purely by
    // tripNumber, so if page 2 also happens to print its own rows starting from "1",
    // merging them unmodified would wrongly fold page 2's trip 1 into page 1's.
    const tripOffset = accumulatedRows.reduce((max, r) => Math.max(max, Number(r.tripNumber)), 0);
    const offsetRows = parsed.rows.map((r) => ({ ...r, tripNumber: String(Number(r.tripNumber) + tripOffset) }));
    accumulatedRows = accumulatedRows.concat(offsetRows);
    renderAccumulated();

    if (!rawLines) {
      statusEl.textContent = 'Added page 2 (Haiku fallback).';
      continuationEl.style.display = 'none';
      secondPageControls.style.display = 'none';
    } else if (END_OF_PAGE_RE.test(rawLines.join(' '))) {
      statusEl.textContent = 'Done (2 pages).';
      continuationEl.style.display = 'none';
      secondPageControls.style.display = 'none';
    } else {
      statusEl.textContent = 'Added page 2 -- but it still doesn\'t look complete either.';
    }
  } catch (err) {
    stopUploadCounter();
    statusEl.textContent = 'Second page request failed.';
    resultEl.textContent = String(err);
  }
});
