// Wires up straddle/index.html's upload flow. Depends on getOcrPageElements /
// wireFileInput / wireCopyButton / startUploadCounter / stopUploadCounter /
// normalizeOrientation (dom-helpers.js), parseRecTextsToRows (parse-rec-texts.js), and
// structureOcrResult / renderTrips (structure.js, render.js) -- all this folder's own
// forks, loaded before this script.
//
// Unlike the Haiku pages, this doesn't POST to a Cloudflare Worker route -- PP-StructureV3
// needs Python + paddlepaddle, which the Worker runtime (cf/) can't run. It POSTs
// straight to the local FastAPI service in server/app.py instead.
//
// Hardcoded to this dev machine's LAN IP rather than "localhost" -- this page is served
// over the LAN via Live Server so it can be opened from a phone, and on a phone
// "localhost" would mean the phone itself, not the machine running server/app.py.
// TODO: replace with a real hostname/URL before this goes into production.
const STRADDLE_ENDPOINT = 'http://192.168.8.161:8000/structure';

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

async function callStraddle(file) {
  const normalized = await normalizeOrientation(file);
  normalizedPreview.src = URL.createObjectURL(normalized);
  previewDetails.style.display = 'block';

  const formData = new FormData();
  formData.append('file', normalized, file.name || 'photo.jpg');

  const response = await fetch(STRADDLE_ENDPOINT, { method: 'POST', body: formData });
  const text = await response.text();
  if (!response.ok) throw new Error(text);
  return JSON.parse(text);
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
    const data = await callStraddle(file);
    stopUploadCounter();

    const lines = data.pages[0].lines;
    resultEl.textContent = JSON.stringify(lines, null, 2);
    rawDetails.style.display = 'block';

    const parsed = parseRecTextsToRows(lines);
    accumulatedRows = parsed.rows;
    accumulatedDate = parsed.date;
    accumulatedDriverName = parsed.driverName;
    renderAccumulated();

    if (END_OF_PAGE_RE.test(lines.join(' '))) {
      statusEl.textContent = 'Done.';
    } else {
      statusEl.textContent = 'Done -- but this page doesn\'t look complete.';
      continuationEl.style.display = 'block';
    }
  } catch (err) {
    stopUploadCounter();
    statusEl.textContent = 'Request failed. Is server/app.py running?';
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
    const data = await callStraddle(file);
    stopUploadCounter();

    const lines = data.pages[0].lines;
    const parsed = parseRecTextsToRows(lines);

    // Renumbers the second page's trips to continue after the first page's, rather
    // than colliding with them -- groupRowsIntoTrips (structure.js) groups purely by
    // tripNumber, so if page 2 also happens to print its own rows starting from "1",
    // merging them unmodified would wrongly fold page 2's trip 1 into page 1's.
    const tripOffset = accumulatedRows.reduce((max, r) => Math.max(max, Number(r.tripNumber)), 0);
    const offsetRows = parsed.rows.map((r) => ({ ...r, tripNumber: String(Number(r.tripNumber) + tripOffset) }));
    accumulatedRows = accumulatedRows.concat(offsetRows);
    renderAccumulated();

    if (END_OF_PAGE_RE.test(lines.join(' '))) {
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
