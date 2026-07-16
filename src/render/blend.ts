import * as THREE from 'three';
import type { BlendFactor } from '../core/layers';

/** Spacescape/Ogre blend factor -> three.js blending factor (1:1 mapping). */
const FACTOR_MAP: Record<BlendFactor, THREE.BlendingDstFactor | THREE.BlendingSrcFactor> = {
  one: THREE.OneFactor,
  zero: THREE.ZeroFactor,
  dest_colour: THREE.DstColorFactor,
  src_colour: THREE.SrcColorFactor,
  one_minus_dest_colour: THREE.OneMinusDstColorFactor,
  one_minus_src_colour: THREE.OneMinusSrcColorFactor,
  dest_alpha: THREE.DstAlphaFactor,
  src_alpha: THREE.SrcAlphaFactor,
  one_minus_dest_alpha: THREE.OneMinusDstAlphaFactor,
  one_minus_src_alpha: THREE.OneMinusSrcAlphaFactor,
};

/** Apply a layer's src/dest blend factors to a material as custom blending. */
export function applyBlend(
  material: THREE.Material,
  src: BlendFactor,
  dst: BlendFactor,
): void {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = FACTOR_MAP[src] as THREE.BlendingSrcFactor;
  material.blendDst = FACTOR_MAP[dst] as THREE.BlendingDstFactor;
  // Never touch framebuffer alpha (keep it at the cleared 1.0). The canvas is
  // composited premultiplied against the page; blend factors like src_alpha
  // writing alpha<1 show up as darkened boxes around quads. The original
  // rendered to an opaque window, which is exactly this behavior. (three
  // ignores the WebGLRenderer alpha:false hint, so this is the real fix.)
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
}
