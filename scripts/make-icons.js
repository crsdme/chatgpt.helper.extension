const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, c]);
}

function encodePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y, width);
      const o = y * (width * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function distRoundRect(px, py, s, r) {
  const x = Math.abs(px - s / 2);
  const y = Math.abs(py - s / 2);
  const hw = s / 2 - 1;
  const hh = s / 2 - 1;
  const dx = Math.max(x - (hw - r), 0);
  const dy = Math.max(y - (hh - r), 0);
  return Math.hypot(dx, dy) - r;
}

function inLine(x, y, x0, y0, x1, y1, w) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (len * len)));
  const px = x0 + t * dx;
  const py = y0 + t * dy;
  return Math.hypot(x - px, y - py) <= w;
}

function icon(size) {
  return encodePng(size, size, (x, y, s) => {
    const r = s * 0.22;
    const d = distRoundRect(x + 0.5, y + 0.5, s, r);
    if (d > 0.6) return [0, 0, 0, 0];
    const edge = Math.max(0, Math.min(1, 1 - d));
    const green = [96, 165, 250];
    const px = x + 0.5;
    const py = y + 0.5;
    const w = s * 0.055;
    const left = s * 0.28;
    const right = s * 0.72;
    const lines =
      inLine(px, py, left, s * 0.34, right, s * 0.34, w) ||
      inLine(px, py, left, s * 0.5, s * 0.58, s * 0.5, w) ||
      inLine(px, py, left, s * 0.66, right, s * 0.66, w);
    const cx = s * 0.72;
    const cy = s * 0.5;
    const dot = Math.hypot(px - cx, py - cy) <= s * 0.07;
    if (lines || dot) return [255, 255, 255, Math.round(255 * edge)];
    return [green[0], green[1], green[2], Math.round(255 * edge)];
  });
}

const dir = path.join(__dirname, "..", "icons");
fs.mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), icon(size));
}
console.log("icons written");
