/**
 * Star color science: blackbody temperature -> RGB (Tanner Helland fit) and
 * B-V color index -> temperature (Ballesteros' formula), shared by the
 * points blackbody color mode and the HYG star-catalog import.
 */
import type { Rgba } from './layers';

/** Kelvin -> linear-ish RGB in 0..1 (valid ~1000K..40000K). */
export function kelvinToRgb(kelvin: number): Rgba {
  const t = Math.min(400, Math.max(10, kelvin / 100));
  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }

  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return { r: c(r), g: c(g), b: c(b), a: 1 };
}

/** B-V color index -> effective temperature (Ballesteros 2012). */
export function bvToKelvin(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}
