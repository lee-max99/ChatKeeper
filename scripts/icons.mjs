import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, checksum]);
}
function color(x, y) {
  const rounded = (a, b, c, d, r) => {
    const dx = Math.max(a + r - x, 0, x - (c - r)); const dy = Math.max(b + r - y, 0, y - (d - r));
    return x >= a && x <= c && y >= b && y <= d && dx * dx + dy * dy <= r * r;
  };
  if (!rounded(2, 2, 126, 126, 26)) return [0, 0, 0, 0];
  if (rounded(31, 23, 97, 108, 8)) {
    if (y >= 77 && y <= 87 && Math.abs(x - 64) <= (87 - y) + 4 || x >= 60 && x <= 68 && y >= 56 && y <= 80) return [112, 84, 232, 255];
    if (x >= 44 && x <= 83 && y >= 39 && y <= 44) return [177, 159, 240, 255];
    return [255, 255, 255, 255];
  }
  return [112, 84, 232, 255];
}
await mkdir('public/icons', { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const rgba = color((x + (sx + .5) / 4) * 128 / size, (y + (sy + .5) / 4) * 128 / size);
      rgba.forEach((v, i) => { sum[i] += v; });
    }
    sum.forEach((v, i) => { raw[y * (size * 4 + 1) + 1 + x * 4 + i] = Math.round(v / 16); });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  await writeFile(`public/icons/${size}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
