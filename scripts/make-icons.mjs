/**
 * Generates the extension's PNG icons locally with zlib (no image libraries,
 * no network). Run via `npm run icons`; output is committed under public/icons.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/**
 * Solid rounded square with a lighter horizontal bar - a simple "stop" mark.
 *
 * Corner coverage is supersampled (SAMPLES x SAMPLES per pixel) so the rounded
 * edge is antialiased rather than jagged, which matters most at 16px.
 */
const SAMPLES = 4;

function renderIcon(size) {
  const bg = [211, 47, 47];
  const fg = [255, 255, 255];
  const radius = Math.round(size * 0.22);
  const barTop = Math.round(size * 0.44);
  const barBottom = Math.round(size * 0.56);
  const barLeft = Math.round(size * 0.24);
  const barRight = Math.round(size * 0.76);

  /** Fraction of this pixel covered by the rounded square, as 0-255. */
  function coverage(x, y) {
    let hits = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const px = x + (sx + 0.5) / SAMPLES;
        const py = y + (sy + 0.5) / SAMPLES;
        // Clamp to the nearest corner centre; inside the straight edges the
        // point is its own centre, so the distance test trivially passes.
        const cx = px < radius ? radius : px >= size - radius ? size - radius : px;
        const cy = py < radius ? radius : py >= size - radius ? size - radius : py;
        const inCorner = (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
        if (inCorner || (px >= radius && px < size - radius) || (py >= radius && py < size - radius)) {
          hits++;
        }
      }
    }
    return Math.round((255 * hits) / (SAMPLES * SAMPLES));
  }

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const isBar = y >= barTop && y < barBottom && x >= barLeft && x < barRight;
      const color = isBar ? fg : bg;
      const offset = 1 + x * 4;
      row[offset] = color[0];
      row[offset + 1] = color[1];
      row[offset + 2] = color[2];
      row[offset + 3] = coverage(x, y);
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(join(outDir, `icon${size}.png`), renderIcon(size));
}
console.log('Icons written to public/icons');
