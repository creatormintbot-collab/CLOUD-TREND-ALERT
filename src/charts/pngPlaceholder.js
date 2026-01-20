const BASE64_1PX =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAp7b+0wAAAAASUVORK5CYII=";

export function placeholderPngBuffer() {
  return Buffer.from(BASE64_1PX, "base64");
}
