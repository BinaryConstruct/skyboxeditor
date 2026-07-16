/**
 * HDR helpers: half-float decoding and Radiance RGBE (.hdr) encoding.
 * .hdr uses new-format RLE scanlines (what UE/stb/most importers expect).
 */

/** IEEE 754 half -> float. */
export function halfToFloat(h: number): number {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/** Half-float RGBA buffer -> Float32 RGBA. */
export function halfBufferToFloat(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = halfToFloat(src[i]);
  return out;
}

/** Float RGBA (bottom-up rows) -> clamped 8-bit RGBA (still bottom-up). */
export function floatToBytes(src: Float32Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(src[i] * 255)));
  }
  return out;
}

function toRgbe(r: number, g: number, b: number, out: Uint8Array, o: number): void {
  const v = Math.max(r, g, b);
  if (!(v > 1e-32)) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  const e = Math.floor(Math.log2(v)) + 1;
  const scale = 2 ** -e * 256;
  out[o] = Math.min(255, Math.floor(r * scale));
  out[o + 1] = Math.min(255, Math.floor(g * scale));
  out[o + 2] = Math.min(255, Math.floor(b * scale));
  out[o + 3] = e + 128;
}

/** RLE-encode one channel of a scanline (Radiance new format). */
function rleChannel(data: Uint8Array, out: number[]): void {
  const n = data.length;
  let i = 0;
  while (i < n) {
    // find run length at i
    let run = 1;
    while (run < 127 && i + run < n && data[i + run] === data[i]) run++;
    if (run >= 4) {
      out.push(128 + run, data[i]);
      i += run;
    } else {
      // literal segment: until a run of >=4 starts or 128 bytes
      let lit = 0;
      let j = i;
      while (j < n && lit < 128) {
        let r = 1;
        while (r < 4 && j + r < n && data[j + r] === data[j]) r++;
        if (r >= 4) break;
        j++;
        lit++;
      }
      out.push(lit);
      for (let k = 0; k < lit; k++) out.push(data[i + k]);
      i += lit;
    }
  }
}

/**
 * Encode float RGBA (bottom-up rows, as GL readback) to a Radiance .hdr blob
 * (top-down, RLE scanlines).
 */
export function encodeRadianceHdr(data: Float32Array, width: number, height: number): Blob {
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const bytes: number[] = [];

  const rgbeRow = new Uint8Array(width * 4);
  const channel = new Uint8Array(width);

  for (let row = 0; row < height; row++) {
    const srcRow = height - 1 - row; // flip to top-down
    for (let x = 0; x < width; x++) {
      const s = (srcRow * width + x) * 4;
      toRgbe(data[s], data[s + 1], data[s + 2], rgbeRow, x * 4);
    }
    // new-format scanline header
    bytes.push(2, 2, (width >> 8) & 0xff, width & 0xff);
    for (let c = 0; c < 4; c++) {
      for (let x = 0; x < width; x++) channel[x] = rgbeRow[x * 4 + c];
      rleChannel(channel, bytes);
    }
  }

  const head = new TextEncoder().encode(header);
  const body = new Uint8Array(bytes);
  return new Blob([head, body], { type: 'image/vnd.radiance' });
}
