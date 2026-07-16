import { describe, expect, it } from 'vitest';
import { applyBakeMode } from './generators';

/** one red, one gray, one black pixel (RGBA) */
const px = () => new Uint8ClampedArray([
  255, 0, 0, 255,
  128, 128, 128, 255,
  0, 0, 0, 0,
]);

describe('applyBakeMode', () => {
  it('color mode is a no-op', () => {
    const data = px();
    applyBakeMode(data, 'color');
    expect(Array.from(data)).toEqual(Array.from(px()));
  });

  it('lightness mode produces grayscale preserving Rec.709 luminance', () => {
    const data = px();
    applyBakeMode(data, 'lightness');
    // red pixel -> lum = 0.2126 * 255 ≈ 54
    expect(data[0]).toBe(54);
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
    // gray stays gray
    expect(data[4]).toBe(128);
    // alpha untouched
    expect(data[3]).toBe(255);
    expect(data[11]).toBe(0);
  });

  it('dark mode inverts luminance and forces opacity for multiply blending', () => {
    const data = px();
    applyBakeMode(data, 'dark');
    // black (empty space) becomes white
    expect(data[8]).toBe(255);
    // red becomes dark: 255 - 54
    expect(data[0]).toBe(201);
    // every pixel opaque so multiply covers the whole quad
    expect(data[3]).toBe(255);
    expect(data[7]).toBe(255);
    expect(data[11]).toBe(255);
  });
});
