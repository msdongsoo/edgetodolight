import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const directory = fileURLToPath(new URL("../assets/", import.meta.url));
mkdirSync(directory, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const label = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  label.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([label, data])), data.length + 8);
  return result;
}

function distanceToSegment(x, y, ax, ay, bx, by) {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}

for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const rounded = Math.hypot(Math.max(0, Math.abs(nx - 0.5) - 0.3), Math.max(0, Math.abs(ny - 0.5) - 0.3)) <= 0.18;
      const check = Math.min(
        distanceToSegment(nx, ny, 0.27, 0.50, 0.44, 0.67),
        distanceToSegment(nx, ny, 0.44, 0.67, 0.75, 0.34)
      ) < 0.045;
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      pixels.set(check ? [255, 255, 255, 255] : [40, 103, 71, rounded ? 255 : 0], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0))
  ]);
  writeFileSync(`${directory}icon-${size}.png`, png);
}
console.log("Generated extension icons (16, 32, 48, 128px).");
