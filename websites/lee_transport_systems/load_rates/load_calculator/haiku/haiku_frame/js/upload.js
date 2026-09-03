// Wires up haiku_frame/index.html's upload flow: the Upload button, the Copy button, and
// the file input, plus the /api/ocr-frame JSON response -> structureOcrResult ->
// renderTrips pipeline. Depends on getOcrPageElements / wireFileInput / wireCopyButton /
// startUploadCounter / stopUploadCounter (dom-helpers.js), structureOcrResult
// (structure.js), and renderTrips (render.js) -- all loaded before this script.
// Doesn't re-destructure tripsTable/summaryEl here even though they're used below --
// render.js already declared those consts, and redeclaring the same const in a second
// <script> tag is a SyntaxError that silently kills this whole file.

const {
  fileInput, fileNameEl, statusEl, resultEl, rawDetails, previewDetails, normalizedPreview,
} = getOcrPageElements();

wireCopyButton(document.getElementById('copyRaw'), resultEl);
wireFileInput(fileInput, fileNameEl, statusEl);

document.getElementById('upload').addEventListener('click', async () => {
  const file = fileInput.files[0];
  if (!file) {
    statusEl.textContent = 'Photo has not been selected.';
    return;
  }

  startUploadCounter(statusEl);
  resultEl.textContent = '';
  rawDetails.style.display = 'none';
  tripsTable.style.display = 'none';
  summaryEl.textContent = '';

  try {
    const normalized = await normalizeOrientation(file);
    normalizedPreview.src = URL.createObjectURL(normalized);
    previewDetails.style.display = 'block';
    const response = await fetch('/api/ocr-frame', {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: normalized,
    });
    stopUploadCounter();

    const data = await response.json();
    resultEl.textContent = JSON.stringify(data, null, 2);
    rawDetails.style.display = 'block';

    if (!response.ok) {
      statusEl.textContent = 'Error (' + response.status + ')';
      return;
    }

    statusEl.textContent = 'Done.';
    renderTrips(structureOcrResult(data));
  } catch (err) {
    stopUploadCounter();
    statusEl.textContent = 'Request failed.';
    resultEl.textContent = String(err);
    rawDetails.style.display = 'block';
  }
});
