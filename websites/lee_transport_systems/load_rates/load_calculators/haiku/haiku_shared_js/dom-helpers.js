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
function wireFileInput(fileInput, fileNameEl) {
  fileInput.addEventListener('change', () => {
    fileNameEl.textContent = fileInput.files[0] ? fileInput.files[0].name : 'No file selected';
  });
}
