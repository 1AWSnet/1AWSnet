// DOM-building helpers shared by haiku_frame/index.html and haiku_regex/index.html.

function makeCell(text, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = text;
  return td;
}

// Built with DOM APIs (not innerHTML) so OCR'd text is always treated as plain text,
// never parsed as markup, however it's punctuated.
function makeMultilineCell(lines, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  lines.forEach((line, i) => {
    if (i > 0) td.appendChild(document.createElement('br'));
    td.appendChild(document.createTextNode(line));
  });
  return td;
}

function makeTripOrderCell(tripNumber, orderNumber) {
  const td = document.createElement('td');
  const bubble = document.createElement('span');
  bubble.className = 'trip-bubble';
  bubble.textContent = tripNumber;
  td.appendChild(bubble);
  td.appendChild(document.createElement('br'));
  td.appendChild(document.createTextNode(orderNumber));
  return td;
}

// Phone photos carry an EXIF orientation tag that browsers honor when displaying
// the image (so it looks upright to the driver) but that Claude's vision API does
// not — it reads raw pixel orientation, so a sideways-tagged photo arrives sideways
// and is much more error-prone to extract from. Drawing through <img> + canvas bakes
// in the correct orientation (browsers apply the EXIF hint during decode/draw) and the
// canvas output has no orientation tag, so what gets uploaded is always upright.
async function normalizeOrientation(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);

    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Keeps the visible filename text in sync with the hidden native file input --
// the input itself is visually hidden in favor of a styled label button, since the
// native "Browse..."/"Choose File" button text isn't consistent across browsers.
// Also clears statusEl, so a stale "Photo has not been selected." from a prior
// no-file upload attempt doesn't linger once a file is actually chosen.
function wireFileInput(fileInput, fileNameEl, statusEl) {
  fileInput.addEventListener('change', () => {
    fileNameEl.textContent = fileInput.files[0] ? fileInput.files[0].name : 'No file selected';
    statusEl.textContent = '';
  });
}

let uploadCounterInterval = null;

// Replaces statusEl's content with a live 1-20s counter while the OCR request is in
// flight, so waiting feels less like the page is stuck. Caps at 20 rather than
// counting forever, matching the "try again" message telling the driver to give up
// and retry around then. Call stopUploadCounter() once the request settles (success,
// non-OK response, or a thrown error) so the counter doesn't keep running and
// overwrite the result/error message a second later.
function startUploadCounter(statusEl) {
  stopUploadCounter();

  statusEl.innerHTML = '';
  const topLine = document.createElement('div');
  topLine.textContent = 'Uploading and extracting text...';
  const counterLine = document.createElement('div');
  counterLine.className = 'upload-counter';
  const bottomLine = document.createElement('div');
  bottomLine.textContent = 'Try again if the counter reaches 20 seconds.';
  statusEl.append(topLine, counterLine, bottomLine);

  let seconds = 0;
  const tick = () => {
    seconds = Math.min(seconds + 1, 20);
    counterLine.textContent = seconds;
  };
  tick();
  uploadCounterInterval = setInterval(tick, 1000);
}

function stopUploadCounter() {
  clearInterval(uploadCounterInterval);
  uploadCounterInterval = null;
}
