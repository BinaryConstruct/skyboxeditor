/**
 * Typed layer parameter models. Defaults match the C++ constructors in
 * SpacescapeLayerNoise / SpacescapeLayerPoints / SpacescapeLayerBillboards
 * exactly (including oddities like billboards' default maxSize < minSize).
 *
 * `hdrPower` / `hdrMultiplier` / `dataFile` are 0.5.x-era params that appear
 * in newer save files (e.g. hdr1.xml) but not in the bundled 0.2-era source;
 * they are modeled as optional so those files round-trip losslessly.
 */

export type BlendFactor =
  | 'one' | 'zero'
  | 'dest_colour' | 'src_colour'
  | 'one_minus_dest_colour' | 'one_minus_src_colour'
  | 'dest_alpha' | 'src_alpha'
  | 'one_minus_dest_alpha' | 'one_minus_src_alpha';

export const BLEND_FACTORS: readonly BlendFactor[] = [
  'one', 'zero',
  'dest_colour', 'src_colour',
  'one_minus_dest_colour', 'one_minus_src_colour',
  'dest_alpha', 'src_alpha',
  'one_minus_dest_alpha', 'one_minus_src_alpha',
];

export type NoiseType = 'fbm' | 'ridged';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** One stop of a multi-stop color ramp; t in [0,1] over the noise value. */
export interface RampStop {
  t: number;
  color: Rgba;
}

export interface LayerCommon {
  name: string;
  seed: number;
  sourceBlendFactor: BlendFactor;
  destBlendFactor: BlendFactor;
  hdrPower?: number;
  hdrMultiplier?: number;
  /** positional layers: excluded from viewport drag-picking when true */
  locked?: boolean;
}

/** Noise-mask params shared by points and billboards layers. */
export interface MaskParams {
  maskEnabled: boolean;
  maskNoiseType: NoiseType;
  maskSeed: number;
  maskOctaves: number;
  maskGain: number;
  maskLacunarity: number;
  maskOffset: number;
  maskPower: number;
  maskScale: number;
  maskThreshold: number;
  maskWarpStrength: number;
  maskWarpScale: number;
}

export interface NoiseLayer extends LayerCommon {
  type: 'noise';
  noiseType: NoiseType;
  octaves: number;
  gain: number;
  lacunarity: number;
  offset: number;
  scale: number;
  powerAmount: number;
  shelfAmount: number;
  ditherAmount: number;
  innerColor: Rgba;
  outerColor: Rgba;
  previewTextureSize: number;
  /** Domain warp fbm(p + k·fbm3(p)) — 0 disables (legacy-identical). */
  warpStrength: number;
  warpScale: number;
  /**
   * Multi-stop color ramp over the noise value. Absent/empty = legacy
   * two-color mix(outerColor, innerColor, n) — bit-identical analytic path.
   */
  colorRamp?: RampStop[];
}

export interface PointsLayer extends LayerCommon, MaskParams {
  type: 'points';
  numPoints: number;
  pointSize: number;
  /** Upper bound for per-star random sizes; <= pointSize means uniform (legacy). */
  pointSizeMax: number;
  nearColor: Rgba;
  farColor: Rgba;
  /** 'blackbody': per-star Kelvin temps + magnitude dimming (v2 feature). */
  colorMode: 'legacy' | 'blackbody';
  tempMin: number;
  tempMax: number;
  /** >1 skews brightness toward dim stars (exponential-ish magnitudes). */
  magnitudePower: number;
  /** 0 = off; squashes star latitudes toward a galactic band. */
  bandStrength: number;
  bandConcentration: number;
  bandAngleDeg: number;
  dataFile?: string;
}

export interface BillboardsLayer extends LayerCommon, MaskParams {
  type: 'billboards';
  numBillboards: number;
  minSize: number;
  maxSize: number;
  texture: string;
  nearColor: Rgba;
  farColor: Rgba;
  /**
   * Weighted hue populations (stop.t = weight): each billboard picks a color
   * from the palette (separate RNG stream). Replaces the near/far color lerp
   * when set; sizes still follow distance.
   */
  huePalette?: RampStop[];
  /** Random in-plane quad rotation (galaxy smudges etc). Default off. */
  randomRotation: boolean;
  /** 0..1: randomly squashes quads along one axis (elliptical variety). */
  aspectJitter: number;
  /**
   * Texture set: with 2+ entries each billboard picks one at random
   * (separate seeded stream) — mixed galaxy types in a single deep-field
   * layer. Absent/short: `texture` is used for every billboard.
   */
  textureMix?: string[];
  dataFile?: string;
}

/**
 * Pseudo-volumetric nebula (new in v2, no legacy counterpart): raymarched
 * emission + absorption through a warped-noise density shell.
 */
export interface VolumetricLayer extends LayerCommon {
  type: 'volumetric';
  noiseType: NoiseType;
  octaves: number;
  gain: number;
  lacunarity: number;
  offset: number;
  scale: number;
  powerAmount: number;
  shelfAmount: number;
  warpStrength: number;
  warpScale: number;
  innerColor: Rgba;
  outerColor: Rgba;
  colorRamp?: RampStop[];
  steps: number;
  density: number;
  absorption: number;
  shellInner: number;
  shellOuter: number;
  previewTextureSize: number;
}

/**
 * Hero galaxy: a positional spiral star-particle cloud placed on the sky
 * sphere (v2 feature, no legacy counterpart).
 */
export interface GalaxyLayer extends LayerCommon {
  type: 'galaxy';
  /** placement direction on the sky */
  dirLonDeg: number;
  dirLatDeg: number;
  /** galaxy radius as a fraction of the sky radius */
  apparentSize: number;
  tiltDeg: number;
  spinDeg: number;
  arms: number;
  windings: number;
  spread: number;
  bulgeSize: number;
  bulgeKelvin: number;
  armKelvin: number;
  numStars: number;
  starSize: number;
  coreGlow: number;
  thickness: number;
  /** 0..1 dark dust clouds along the inner arm edges */
  dust: number;
  /** 0..1 bright HII/reflection nebula clumps on the arm knots */
  nebulae: number;
}

/**
 * Positional sun: a close-up star (limb-darkened disc + corona) placed on
 * the sky sphere. A binary system is simply two sun layers. (Phase 3a v2.)
 */
export interface SunLayer extends LayerCommon {
  type: 'sun';
  dirLonDeg: number;
  dirLatDeg: number;
  /** billboard half-size as a fraction of the sky radius */
  apparentSize: number;
  /** in-plane rotation of the sprite */
  rotationDeg: number;
  kelvin: number;
  limbDarkening: number;
  granulation: number;
  corona: number;
  coronaExtent: number;
  prominences: number;
  glow: number;
}

/**
 * Positional planet: shaded sphere sprite with optional rings, placed on the
 * sky sphere. Occludes what's behind it (default blend one / 1-src_alpha).
 */
export interface PlanetLayer extends LayerCommon {
  type: 'planet';
  dirLonDeg: number;
  dirLatDeg: number;
  apparentSize: number;
  /** in-plane rotation of the sprite (rings + lighting rotate with it) */
  rotationDeg: number;
  baseColor: Rgba;
  secondColor: Rgba;
  noiseScale: number;
  octaves: number;
  banding: number;
  lightAngleDeg: number;
  atmosphereColor: Rgba;
  atmosphereWidth: number;
  ringAmount: number;
  ringInner: number;
  ringOuter: number;
  ringTiltDeg: number;
  ringColor: Rgba;
}

/**
 * Black hole: a distortion layer — gravitationally lenses the composite of
 * the layers below it (captured to a cubemap), plus photon ring and an
 * additive accretion disc. The lens pass replaces the background inside its
 * footprint, so layer order matters: put it above what it should bend.
 */
export interface BlackHoleLayer extends LayerCommon {
  type: 'blackhole';
  dirLonDeg: number;
  dirLatDeg: number;
  /** horizon angular radius, radians-ish (fraction of sky radius) */
  apparentSize: number;
  /** 0..1 bending strength (scales the Einstein radius) */
  lensStrength: number;
  /** 0..1 photon-ring glow */
  photonRing: number;
  /** 0 disables the accretion disc */
  discAmount: number;
  discInner: number;   // in horizon radii
  discOuter: number;   // in horizon radii
  discTiltDeg: number;
  discSpinDeg: number;
  discKelvin: number;
  /** 0..1 approaching-side Doppler brightening */
  discDoppler: number;
}

/**
 * Free-placement sprite quad: any texture (bundled flare, procedural bake,
 * user upload, PCG bake) pinned to the sky sphere with spherical-polar
 * placement, angular size, aspect stretch, and in-plane rotation. The
 * generic carrier for PCG output and imported imagery.
 */
export interface SpriteLayer extends LayerCommon {
  type: 'sprite';
  /** texture id: bundled file name, 'proc:*', or 'user:*' */
  texture: string;
  dirLonDeg: number;
  dirLatDeg: number;
  /** quad half-height as a fraction of the sky radius */
  apparentSize: number;
  /** width / height stretch */
  aspect: number;
  /** in-plane rotation */
  rotationDeg: number;
}

export type Layer =
  | NoiseLayer | PointsLayer | BillboardsLayer | VolumetricLayer | GalaxyLayer
  | SunLayer | PlanetLayer | BlackHoleLayer | SpriteLayer;
export type LayerType = Layer['type'];

export const rgba = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a });

const commonDefaults = (): Omit<LayerCommon, 'name'> => ({
  seed: 0,
  sourceBlendFactor: 'one',
  destBlendFactor: 'one',
});

const maskDefaults = (): MaskParams => ({
  maskEnabled: false,
  maskNoiseType: 'fbm',
  maskSeed: 1,
  maskOctaves: 1,
  maskGain: 0.5,
  maskLacunarity: 2.0,
  maskOffset: 1.0,
  maskPower: 1.0,
  maskScale: 1.0,
  maskThreshold: 0.0,
  maskWarpStrength: 0.0,
  maskWarpScale: 1.0,
});

export function defaultNoiseLayer(name = 'Noise Layer'): NoiseLayer {
  return {
    type: 'noise',
    name,
    ...commonDefaults(),
    noiseType: 'fbm',
    octaves: 2,
    gain: 0.5,
    lacunarity: 2.0,
    offset: 1.0,
    scale: 1.0,
    powerAmount: 1.0,
    shelfAmount: 0.0,
    ditherAmount: 0.03,
    innerColor: rgba(1, 1, 1),
    outerColor: rgba(0, 0, 0),
    previewTextureSize: 256,
    warpStrength: 0.0,
    warpScale: 1.0,
  };
}

export function defaultPointsLayer(name = 'Points Layer'): PointsLayer {
  return {
    type: 'points',
    name,
    ...commonDefaults(),
    ...maskDefaults(),
    numPoints: 1000,
    pointSize: 1,
    pointSizeMax: 0,
    nearColor: rgba(1, 1, 1),
    farColor: rgba(0, 0, 0),
    colorMode: 'legacy',
    tempMin: 2500,
    tempMax: 12000,
    magnitudePower: 1,
    bandStrength: 0,
    bandConcentration: 2,
    bandAngleDeg: 0,
  };
}

export function defaultBillboardsLayer(name = 'Billboards Layer'): BillboardsLayer {
  return {
    type: 'billboards',
    name,
    ...commonDefaults(),
    ...maskDefaults(),
    numBillboards: 100,
    // Original C++ defaults really are maxSize 0.01 < minSize 0.05 — preserved.
    minSize: 0.05,
    maxSize: 0.01,
    texture: '',
    nearColor: rgba(1, 1, 1),
    farColor: rgba(1, 1, 1),
    randomRotation: false,
    aspectJitter: 0,
  };
}

export function defaultVolumetricLayer(name = 'Volumetric Nebula'): VolumetricLayer {
  return {
    type: 'volumetric',
    name,
    seed: 0,
    sourceBlendFactor: 'one',
    // premultiplied-style output (see VOLUME_FRAG)
    destBlendFactor: 'one_minus_src_alpha',
    noiseType: 'fbm',
    octaves: 6,
    gain: 0.5,
    lacunarity: 2.0,
    offset: 1.0,
    scale: 1.5,
    powerAmount: 1.0,
    shelfAmount: 0.25,
    warpStrength: 0.5,
    warpScale: 1.5,
    innerColor: rgba(0.85, 0.75, 1.0),
    outerColor: rgba(0.05, 0.02, 0.12),
    steps: 48,
    density: 4.0,
    absorption: 2.0,
    shellInner: 0.5,
    shellOuter: 1.5,
    previewTextureSize: 256,
  };
}

export function defaultGalaxyLayer(name = 'Galaxy'): GalaxyLayer {
  return {
    type: 'galaxy',
    name,
    seed: 1,
    sourceBlendFactor: 'one',
    destBlendFactor: 'one',
    dirLonDeg: 0,
    dirLatDeg: 25,
    apparentSize: 0.45,
    tiltDeg: 55,
    spinDeg: 0,
    arms: 2,
    windings: 1.2,
    spread: 0.35,
    bulgeSize: 0.25,
    bulgeKelvin: 4200,
    armKelvin: 9500,
    numStars: 14000,
    starSize: 2,
    coreGlow: 1,
    thickness: 0.07,
    dust: 0.5,
    nebulae: 0.6,
  };
}

export function defaultSunLayer(name = 'Sun'): SunLayer {
  return {
    type: 'sun',
    name,
    seed: 3,
    // premultiplied-over: the photosphere disc occludes the sky behind it
    // (alpha reconstruction makes the disc opaque, corona luminance-alpha)
    sourceBlendFactor: 'one',
    destBlendFactor: 'one_minus_src_alpha',
    dirLonDeg: -40,
    dirLatDeg: 15,
    apparentSize: 0.12,
    rotationDeg: 0,
    kelvin: 5800,
    limbDarkening: 0.6,
    granulation: 0.35,
    corona: 0.7,
    coronaExtent: 1.4,
    prominences: 0.4,
    glow: 0.5,
  };
}

export function defaultPlanetLayer(name = 'Planet'): PlanetLayer {
  return {
    type: 'planet',
    name,
    seed: 7,
    // premultiplied-over: the sprite occludes what's behind it
    sourceBlendFactor: 'one',
    destBlendFactor: 'one_minus_src_alpha',
    dirLonDeg: 30,
    dirLatDeg: -10,
    apparentSize: 0.1,
    rotationDeg: 0,
    baseColor: rgba(0.16, 0.3, 0.5),
    secondColor: rgba(0.75, 0.68, 0.55),
    noiseScale: 3,
    octaves: 5,
    banding: 0,
    lightAngleDeg: 25,
    atmosphereColor: rgba(0.4, 0.65, 1),
    atmosphereWidth: 0.08,
    ringAmount: 0,
    ringInner: 1.45,
    ringOuter: 2.2,
    ringTiltDeg: 22,
    ringColor: rgba(0.78, 0.7, 0.58),
  };
}

export function defaultBlackHoleLayer(name = 'Black Hole'): BlackHoleLayer {
  return {
    type: 'blackhole',
    name,
    seed: 0,
    sourceBlendFactor: 'one',
    destBlendFactor: 'one',
    dirLonDeg: 0,
    dirLatDeg: 0,
    apparentSize: 0.05,
    lensStrength: 0.6,
    photonRing: 0.7,
    discAmount: 0.8,
    discInner: 1.7,
    discOuter: 3.6,
    discTiltDeg: 72,
    discSpinDeg: 0,
    discKelvin: 4500,
    discDoppler: 0.5,
  };
}

export function defaultSpriteLayer(name = 'Sprite'): SpriteLayer {
  return {
    type: 'sprite',
    name,
    seed: 0,
    sourceBlendFactor: 'one',
    destBlendFactor: 'one',
    texture: 'default.png',
    dirLonDeg: 0,
    dirLatDeg: 0,
    apparentSize: 0.15,
    aspect: 1,
    rotationDeg: 0,
  };
}

export function defaultLayer(type: LayerType, name?: string): Layer {
  switch (type) {
    case 'noise': return defaultNoiseLayer(name);
    case 'points': return defaultPointsLayer(name);
    case 'billboards': return defaultBillboardsLayer(name);
    case 'volumetric': return defaultVolumetricLayer(name);
    case 'galaxy': return defaultGalaxyLayer(name);
    case 'sun': return defaultSunLayer(name);
    case 'planet': return defaultPlanetLayer(name);
    case 'blackhole': return defaultBlackHoleLayer(name);
    case 'sprite': return defaultSpriteLayer(name);
  }
}
