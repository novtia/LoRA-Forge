const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function crc32(buf) {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = t[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const d = data || Buffer.alloc(0);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(type), d]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}

function makePNG(W, H) {
  const raw = Buffer.alloc(H * (1 + W * 4));
  for (let y = 0; y < H; y++) {
    const row = y * (1 + W * 4);
    raw[row] = 0;
    for (let x = 0; x < W; x++) {
      const p = row + 1 + x * 4;
      const nx = x / W, ny = y / H;
      // Skewed parallelogram (matches logo-mark clip-path)
      const skew = 0.08;
      const left = skew + (0 - skew) * ny;
      const right = (1 - skew) + (1 - (1 - skew)) * ny;
      const inside = nx >= left && nx <= right && ny >= 0.15 && ny <= 0.85;
      if (inside) {
        raw[p] = 0xd4; raw[p + 1] = 0xff; raw[p + 2] = 0x00; raw[p + 3] = 0xff;
      } else {
        raw[p] = 0x11; raw[p + 1] = 0x11; raw[p + 2] = 0x11; raw[p + 3] = 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    pngChunk("IEND"),
  ]);
}

const out = path.resolve(__dirname, "..", "app-icon.png");
fs.writeFileSync(out, makePNG(1024, 1024));
console.log("wrote", out);
