export const FONT_5X7 = {
  "0": [0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110],
  "1": [0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110],
  "2": [0b01110,0b10001,0b00001,0b00010,0b00100,0b01000,0b11111],
  "3": [0b11110,0b00001,0b00001,0b01110,0b00001,0b00001,0b11110],
  "4": [0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010],
  "5": [0b11111,0b10000,0b10000,0b11110,0b00001,0b00001,0b11110],
  "6": [0b01110,0b10000,0b10000,0b11110,0b10001,0b10001,0b01110],
  "7": [0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000],
  "8": [0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110],
  "9": [0b01110,0b10001,0b10001,0b01111,0b00001,0b00001,0b01110],
  ".": [0b00000,0b00000,0b00000,0b00000,0b00000,0b00110,0b00110],
  "-": [0b00000,0b00000,0b00000,0b11111,0b00000,0b00000,0b00000]
};

export function drawText5x7(setPixel, x, y, text, rgba = [0,0,0,255], scale = 1) {
  const s = String(text ?? "");
  let cx = x;
  for (const ch of s) {
    const glyph = FONT_5X7[ch];
    if (!glyph) { cx += 6 * scale; continue; }
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        const on = (bits >> (4 - col)) & 1;
        if (!on) continue;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++)
          setPixel(cx + col * scale + dx, y + row * scale + dy, rgba);
      }
    }
    cx += 6 * scale;
  }
}
