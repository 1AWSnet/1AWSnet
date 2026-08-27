// Forked from haiku/haiku_shared_js/dom-helpers.js so Straddle-driven fixes never
// change the Haiku pages' behavior (and vice versa) -- the two copies are free to
// diverge from here on.
//
// DOM-building helpers used by straddle/index.html.

// Looks up the element IDs the page's markup provides. Called once at the top of the
// page's script.
function getOcrPageElements() {
  return {
    fileInput: document.getElementById('photo'),
    fileNameEl: document.getElementById('fileName'),
    statusEl: document.getElementById('status'),
    resultEl: document.getElementById('result'),
    rawDetails: document.getElementById('rawDetails'),
    previewDetails: document.getElementById('previewDetails'),
    normalizedPreview: document.getElementById('normalizedPreview'),
    tripsTable: document.getElementById('tripsTable'),
    tripsBody: document.getElementById('tripsBody'),
    summaryEl: document.getElementById('summary'),
  };
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
// the image (so it looks upright to the driver) but that the OCR pipeline does not --
// it reads raw pixel orientation, so a sideways-tagged photo arrives sideways and is
// much more error-prone to extract from. Drawing through <img> + canvas bakes in the
// correct orientation (browsers apply the EXIF hint during decode/draw) and the canvas
// output has no orientation tag, so what gets uploaded is always upright.
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

// Copies sourceEl's current text to the clipboard on click, with brief "Copied"/"Failed"
// feedback. button sits inside a <summary>, so the click is stopped from also toggling
// the enclosing <details>.
//
// navigator.clipboard only exists in a "secure context" (HTTPS, or literally
// "localhost") -- this page is routinely opened over plain http:// via a LAN IP (e.g.
// Live Server on a phone), where it's simply undefined. Falls back to the older
// execCommand-via-hidden-textarea approach, which works over plain HTTP, whenever the
// modern API isn't there or rejects.
function wireCopyButton(button, sourceEl) {
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    let copied = false;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(sourceEl.textContent);
        copied = true;
      }
    } catch {
      // Falls through to the execCommand fallback below.
    }

    if (!copied) {
      const textarea = document.createElement('textarea');
      textarea.value = sourceEl.textContent;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      }
      document.body.removeChild(textarea);
    }

    const original = button.textContent;
    button.textContent = copied ? 'Copied' : 'Copy failed';
    setTimeout(() => { button.textContent = original; }, 1500);
  });
}

let uploadCounterInterval = null;

// Replaces statusEl's content with a live 1-35s counter while the OCR request is in
// flight, so waiting feels less like the page is stuck. Caps at 35 rather than
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
  bottomLine.append('Try again if', document.createElement('br'), 'the counter reaches 35 seconds.');
  statusEl.append(topLine, counterLine, bottomLine);

  let seconds = 0;
  const tick = () => {
    seconds = Math.min(seconds + 1, 35);
    counterLine.textContent = seconds;
  };
  tick();
  uploadCounterInterval = setInterval(tick, 1000);
}

function stopUploadCounter() {
  clearInterval(uploadCounterInterval);
  uploadCounterInterval = null;
}
