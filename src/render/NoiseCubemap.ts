/**
 * Renders seeded FBM/ridged noise into a cubemap render target, mirroring
 * SpacescapeLayer::renderNoiseToTexture. One instance per noise layer (and
 * per mask bake).
 */
import * as THREE from 'three';
import type { NoiseLayer, NoiseType, RampStop, Rgba, VolumetricLayer } from '../core/layers';
import { bakeRampLut } from '../core/palettes';
import { PerlinNoise } from '../core/perlin';
import { NOISE_FRAG, NOISE_VERT, VOLUME_FRAG } from './noiseGlsl';

export interface NoiseParams {
  seed: number;
  noiseType: NoiseType;
  innerColor: Rgba;
  outerColor: Rgba;
  octaves: number;
  lacunarity: number;
  gain: number;
  powerAmount: number;
  shelfAmount: number;
  ditherAmount: number;
  scale: number;
  offset: number;
  warpStrength: number;
  warpScale: number;
  colorRamp?: RampStop[];
  hdrPower?: number;
  hdrMultiplier?: number;
  /** Present only for the volumetric raymarch variant. */
  volumetric?: {
    steps: number;
    density: number;
    absorption: number;
    shellInner: number;
    shellOuter: number;
  };
}

export function noiseParamsFromVolumetric(layer: VolumetricLayer): NoiseParams {
  return {
    seed: layer.seed,
    noiseType: layer.noiseType,
    innerColor: layer.innerColor,
    outerColor: layer.outerColor,
    octaves: layer.octaves,
    lacunarity: layer.lacunarity,
    gain: layer.gain,
    powerAmount: layer.powerAmount,
    shelfAmount: layer.shelfAmount,
    ditherAmount: 0,
    scale: layer.scale,
    offset: layer.offset,
    warpStrength: layer.warpStrength,
    warpScale: layer.warpScale,
    colorRamp: layer.colorRamp,
    hdrPower: layer.hdrPower,
    hdrMultiplier: layer.hdrMultiplier,
    volumetric: {
      steps: layer.steps,
      density: layer.density,
      absorption: layer.absorption,
      shellInner: layer.shellInner,
      shellOuter: layer.shellOuter,
    },
  };
}

export function noiseParamsFromLayer(layer: NoiseLayer): NoiseParams {
  return {
    seed: layer.seed,
    noiseType: layer.noiseType,
    innerColor: layer.innerColor,
    outerColor: layer.outerColor,
    octaves: layer.octaves,
    lacunarity: layer.lacunarity,
    gain: layer.gain,
    powerAmount: layer.powerAmount,
    shelfAmount: layer.shelfAmount,
    ditherAmount: layer.ditherAmount,
    scale: layer.scale,
    offset: layer.offset,
    warpStrength: layer.warpStrength,
    warpScale: layer.warpScale,
    colorRamp: layer.colorRamp,
    hdrPower: layer.hdrPower,
    hdrMultiplier: layer.hdrMultiplier,
  };
}

/** Mask bake params (renderNoiseToTexture with White/Black and no dither). */
export function noiseParamsFromMask(layer: {
  maskSeed: number;
  maskNoiseType: NoiseType;
  maskOctaves: number;
  maskLacunarity: number;
  maskGain: number;
  maskPower: number;
  maskThreshold: number;
  maskScale: number;
  maskOffset: number;
  maskWarpStrength: number;
  maskWarpScale: number;
}): NoiseParams {
  return {
    seed: layer.maskSeed,
    noiseType: layer.maskNoiseType,
    innerColor: { r: 1, g: 1, b: 1, a: 1 },
    outerColor: { r: 0, g: 0, b: 0, a: 1 },
    octaves: layer.maskOctaves,
    lacunarity: layer.maskLacunarity,
    gain: layer.maskGain,
    powerAmount: layer.maskPower,
    shelfAmount: layer.maskThreshold,
    ditherAmount: 0,
    scale: layer.maskScale,
    offset: layer.maskOffset,
    warpStrength: layer.maskWarpStrength,
    warpScale: layer.maskWarpScale,
  };
}

/** 256x1 grad LUT as RGBA (three dropped RGBFormat); alpha unused. */
function gradTextureRgba(perlin: PerlinNoise): Uint8Array {
  const rgb = perlin.buildGradTexture();
  const rgba = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

function makeLutTexture(data: Uint8Array, width: number, height: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  // TFO_NONE + TAM_WRAP in the original — required for correct hashing
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class NoiseCubemap {
  readonly size: number;
  readonly renderTarget: THREE.WebGLCubeRenderTarget;
  private cubeCamera: THREE.CubeCamera;
  private rttScene = new THREE.Scene();
  private material: THREE.ShaderMaterial;
  private boxGeometry!: THREE.BoxGeometry;
  private permTex: THREE.DataTexture | null = null;
  private gradTex: THREE.DataTexture | null = null;
  private rampTex: THREE.DataTexture | null = null;
  private rampKey: string | null = null;
  private lutSeed: number | null = null;

  /**
   * @param pixelType 'half' (default) for HDR-capable layer cubemaps;
   * 'byte' for mask bakes, whose 0..255 readback feeds the legacy
   * rejection-sampling math and must stay 8-bit.
   * @param variant 'noise' (flat legacy shader) or 'volumetric' (raymarch).
   */
  constructor(size: number, pixelType: 'half' | 'byte' = 'half', variant: 'noise' | 'volumetric' = 'noise') {
    this.size = size;
    this.renderTarget = new THREE.WebGLCubeRenderTarget(size, {
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      type: pixelType === 'half' ? THREE.HalfFloatType : THREE.UnsignedByteType,
    });
    this.cubeCamera = new THREE.CubeCamera(0.1, 10, this.renderTarget);

    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: NOISE_VERT,
      fragmentShader: variant === 'volumetric' ? VOLUME_FRAG : NOISE_FRAG,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        volSteps: { value: 48 },
        volDensity: { value: 4 },
        volAbsorption: { value: 2 },
        shellInner: { value: 0.5 },
        shellOuter: { value: 1.5 },
        permTexture: { value: null },
        gradTexture: { value: null },
        ditherAmt: { value: 0 },
        gain: { value: 0.5 },
        innerColor: { value: new THREE.Vector3(1, 1, 1) },
        lacunarity: { value: 2 },
        offset: { value: 1 },
        octaves: { value: 1 },
        outerColor: { value: new THREE.Vector3(0, 0, 0) },
        powerAmt: { value: 1 },
        shelfAmt: { value: 0 },
        noiseScale: { value: 1 },
        ridgedNoise: { value: false },
        warpStrength: { value: 0 },
        warpScale: { value: 1 },
        useRamp: { value: false },
        rampTexture: { value: null },
        hdrPowerAmt: { value: 1 },
        hdrMultiplierAmt: { value: 1 },
      },
    });

    this.boxGeometry = new THREE.BoxGeometry(2, 2, 2);
    this.rttScene.add(new THREE.Mesh(this.boxGeometry, this.material));
  }

  get texture(): THREE.CubeTexture {
    return this.renderTarget.texture;
  }

  /** Update uniforms/LUTs and re-render all six faces. */
  render(renderer: THREE.WebGLRenderer, params: NoiseParams): void {
    if (this.lutSeed !== params.seed) {
      this.permTex?.dispose();
      this.gradTex?.dispose();
      const perlin = new PerlinNoise(params.seed);
      this.permTex = makeLutTexture(perlin.buildPermTexture(), 256, 256);
      this.gradTex = makeLutTexture(gradTextureRgba(perlin), 256, 1);
      this.lutSeed = params.seed;
    }

    const u = this.material.uniforms;
    u.permTexture.value = this.permTex;
    u.gradTexture.value = this.gradTex;
    u.ditherAmt.value = params.ditherAmount;
    u.gain.value = params.gain;
    (u.innerColor.value as THREE.Vector3).set(params.innerColor.r, params.innerColor.g, params.innerColor.b);
    u.lacunarity.value = params.lacunarity;
    u.offset.value = params.offset;
    u.octaves.value = params.octaves;
    (u.outerColor.value as THREE.Vector3).set(params.outerColor.r, params.outerColor.g, params.outerColor.b);
    u.powerAmt.value = params.powerAmount;
    u.shelfAmt.value = params.shelfAmount;
    u.noiseScale.value = params.scale;
    u.ridgedNoise.value = params.noiseType === 'ridged';
    u.warpStrength.value = params.warpStrength;
    u.warpScale.value = params.warpScale;

    u.hdrPowerAmt.value = params.hdrPower ?? 1;
    u.hdrMultiplierAmt.value = params.hdrMultiplier ?? 1;

    if (params.volumetric) {
      u.volSteps.value = Math.max(4, params.volumetric.steps);
      u.volDensity.value = params.volumetric.density;
      u.volAbsorption.value = params.volumetric.absorption;
      u.shellInner.value = params.volumetric.shellInner;
      u.shellOuter.value = Math.max(params.volumetric.shellInner + 0.01, params.volumetric.shellOuter);
    }

    const ramp = params.colorRamp;
    const useRamp = !!ramp && ramp.length >= 2;
    u.useRamp.value = useRamp;
    if (useRamp) {
      const key = JSON.stringify(ramp);
      if (key !== this.rampKey) {
        this.rampTex?.dispose();
        const tex = new THREE.DataTexture(bakeRampLut(ramp), 256, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.colorSpace = THREE.NoColorSpace;
        tex.needsUpdate = true;
        this.rampTex = tex;
        this.rampKey = key;
      }
      u.rampTexture.value = this.rampTex;
    }

    this.cubeCamera.update(renderer, this.rttScene);
  }

  /** Read back all six faces as RGBA bytes (for CPU mask sampling). */
  readFaces(renderer: THREE.WebGLRenderer): Uint8Array[] {
    const faces: Uint8Array[] = [];
    for (let face = 0; face < 6; face++) {
      const buf = new Uint8Array(this.size * this.size * 4);
      renderer.readRenderTargetPixels(this.renderTarget, 0, 0, this.size, this.size, buf, face);
      faces.push(buf);
    }
    return faces;
  }

  dispose(): void {
    this.permTex?.dispose();
    this.gradTex?.dispose();
    this.rampTex?.dispose();
    this.boxGeometry.dispose();
    this.material.dispose();
    this.renderTarget.dispose();
  }
}
