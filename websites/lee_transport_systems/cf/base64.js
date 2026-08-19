// Anthropic's API needs base64 text, not raw binary. Chunked to avoid exceeding the
// JS engine's max function-argument limit on large images.
export function base64FromArrayBuffer(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
