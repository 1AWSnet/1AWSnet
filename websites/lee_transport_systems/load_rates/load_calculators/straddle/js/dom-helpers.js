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

// Client-side image preprocessing -- mirrors server/app.py's old preprocess_image():
// fix EXIF orientation, downscale so the long side is MAX_LONG_SIDE, then adaptive-
// threshold binarize. This runs here rather than on the box because the box is now
// remote (over a Cloudflare Tunnel): shipping the full ~3MB phone photo there and
// letting it shrink the image was most of the round trip. After this the upload is
// ~150KB. Whatever this returns is byte-for-byte what the pipeline sees -- upload.js
// puts it straight into the page's "What was actually sent to the pipeline" preview.
//
// Orientation: phone photos carry an EXIF orientation tag browsers honor when displaying
// the image (so it looks upright to the driver) but the OCR pipeline does not -- it
// reads raw pixel orientation. Drawing through <img> + canvas bakes in the orientation
// the browser applied and drops the tag, so what's uploaded is always upright.
const MAX_LONG_SIDE = 1500;
const ADAPTIVE_BLOCK = 35; // local-mean window (odd); the value app.py passed to OpenCV
const ADAPTIVE_C = 15;     // subtracted from the local mean before thresholding

async function preprocessImage(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = objectUrl;
    });

    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const longSide = Math.max(width, height);
    if (longSide > MAX_LONG_SIDE) {
      const scale = MAX_LONG_SIDE / longSide;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // Scales straight from the decoded image to the smaller target -- no full-res
    // canvas is ever allocated. 'high' quality keeps small text legible through a big
    // downscale (a ~4000px photo to 1500px).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);

    const imageData = ctx.getImageData(0, 0, width, height);
    binarizeInPlace(imageData);
    ctx.putImageData(imageData, 0, 0);

    // PNG, not JPEG: the output is 2-value black-on-white, which PNG stores losslessly,
    // smaller than the equivalent JPEG, and with no ringing along the text edges.
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// Adaptive-threshold binarization (OpenCV's adaptiveThreshold + THRESH_BINARY): a pixel
// goes white if its grey value exceeds (local mean - ADAPTIVE_C), else black. The local
// mean is a box average over an ADAPTIVE_BLOCK-square window, via a separable sliding-
// window sum so cost doesn't grow with window size. app.py used the Gaussian-weighted
// variant; a flat box mean is a close, much shorter approximation for a page scan.
// Rewrites the RGBA data in place: R=G=B set to 0 or 255, A left at 255.
function binarizeInPlace(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;

  const grey = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    grey[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }

  const mean = boxBlur(grey, width, height, (ADAPTIVE_BLOCK - 1) / 2);

  for (let i = 0; i < n; i++) {
    const v = grey[i] > mean[i] - ADAPTIVE_C ? 255 : 0;
    const o = i * 4;
    data[o] = data[o + 1] = data[o + 2] = v;
    data[o + 3] = 255;
  }
}

// Separable box blur. blurLine walks one row (stride 1) or one column (stride `width`)
// keeping a running sum of the [i-radius, i+radius] window; edge pixels divide by the
// clamped window size so borders aren't pulled toward zero.
function boxBlur(src, width, height, radius) {
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  for (let y = 0; y < height; y++) blurLine(src, tmp, width, 1, y * width, radius);
  for (let x = 0; x < width; x++) blurLine(tmp, out, height, width, x, radius);
  return out;
}

function blurLine(src, dst, len, stride, base, radius) {
  let sum = 0;
  const first = Math.min(radius, len - 1);
  for (let k = 0; k <= first; k++) sum += src[base + k * stride];

  for (let i = 0; i < len; i++) {
    const lo = i - radius < 0 ? 0 : i - radius;
    const hi = i + radius > len - 1 ? len - 1 : i + radius;
    dst[base + i * stride] = sum / (hi - lo + 1);

    const drop = i - radius;
    const add = i + radius + 1;
    if (drop >= 0) sum -= src[base + drop * stride];
    if (add <= len - 1) sum += src[base + add * stride];
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
