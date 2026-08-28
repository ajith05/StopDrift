/**
 * The icons are generated PNGs written byte by byte with zlib, so nothing but
 * a decode proves they are valid. These tests decode the committed files and
 * check the properties Chrome and the toolbar actually depend on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';

const SIZES = [16, 48, 128];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

interface Decoded {
  width: number;
  height: number;
  at(x: number, y: number): [number, number, number, number];
}

/** Decode one of our own RGBA, filter-0, non-interlaced PNGs. */
function decode(size: number): Decoded {
  const bytes = readFileSync(`public/icons/icon${size}.png`);
  expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      depth = bytes[offset + 16];
      colorType = bytes[offset + 17];
    }
    if (type === 'IDAT') idat.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  expect(depth).toBe(8);
  expect(colorType).toBe(6); // RGBA

  const total = idat.reduce((n, c) => n + c.length, 0);
  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of idat) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  const pixels = inflateSync(joined);

  return {
    width,
    height,
    at(x, y) {
      const row = y * (1 + width * 4);
      expect(pixels[row]).toBe(0); // filter type: none
      const i = row + 1 + x * 4;
      return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    },
  };
}

describe.each(SIZES)('icon%i.png', (size) => {
  const img = decode(size);

  it('is a square PNG of the declared size', () => {
    expect([img.width, img.height]).toEqual([size, size]);
  });

  it('is fully opaque at the centre and fully transparent at the corner', () => {
    expect(img.at(size >> 1, size >> 1)[3]).toBe(255);
    expect(img.at(0, 0)[3]).toBe(0);
  });

  it('has an antialiased rounded edge', () => {
    const alphas = new Set<number>();
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) alphas.add(img.at(x, y)[3]);
    }
    // Hard edges would yield exactly {0, 255}; supersampling adds partials.
    expect(alphas.size).toBeGreaterThan(2);
    expect(alphas.has(0)).toBe(true);
    expect(alphas.has(255)).toBe(true);
  });

  it('draws a white bar across the middle', () => {
    const centre = img.at(size >> 1, size >> 1);
    expect(centre.slice(0, 3)).toEqual([255, 255, 255]);
  });

  it('uses the red background away from the bar', () => {
    // A quarter of the way down is above the bar (which spans 44%-56%).
    const above = img.at(size >> 1, Math.floor(size * 0.25));
    expect(above.slice(0, 3)).toEqual([211, 47, 47]);
  });
});

describe('icon set', () => {
  it('scales the bar proportionally across every size', () => {
    const ratios = SIZES.map((size) => {
      const img = decode(size);
      let bar = 0;
      for (let y = 0; y < img.height; y++) {
        const [r, g, b, a] = img.at(img.width >> 1, y);
        if (r === 255 && g === 255 && b === 255 && a === 255) bar++;
      }
      return Math.round((100 * bar) / size);
    });
    // Same proportion at every size, so the mark looks identical when scaled.
    expect(new Set(ratios).size).toBe(1);
  });
});
