/**
 * Black hole distortion layer: a lens quad that replaces the sky behind it
 * with a gravitationally-bent sample of a background cubemap (captured from
 * the scene with the lens hidden) and renders the accretion disc ANALYTICALLY
 * per pixel from a precomputed geodesic trajectory LUT — the same algorithm
 * as the PCG sprite baker (src/gen/anomalyGen.ts), so the layer shows the
 * true Luminet anatomy: the primary disc image (near side passing straight
 * in front, far side lensed into the hat over the shadow) plus the inverted
 * secondary image hugging the photon ring, brightest opposite the hat, the
 * two swapping roles as the disc tilts through edge-on.
 */
import * as THREE from 'three';
import { DataUtils } from 'three';
import { kelvinToRgb } from '../core/blackbody';
import {
  CRITICAL_B, buildDeflectionLut, buildTrajectoryLut,
} from '../gen/geodesic';
import type { BlackHoleLayer } from '../core/layers';

const LENS_VERT = /* glsl */ `
out vec3 vWorld;

void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const LENS_FRAG = /* glsl */ `
precision highp float;

uniform samplerCube bgCube;
uniform sampler2D deflLut; // geodesic bend angle over x = theta/thetaH
uniform vec3 bhDir;
uniform float thetaH;    // shadow angular radius (rad) = critical impact angle
uniform float thetaE;    // Einstein radius (rad)
uniform float coverage;  // lens footprint angular radius (rad)
uniform float ringAmt;
uniform float lutScale;  // thetaE^2 * b_c / (2 thetaH): weak-field continuity
uniform float lutXMax;   // LUT domain end in x

// analytic disc (all radii in Schwarzschild units, rs = 1)
uniform sampler2D trajLut;  // r(b, phi) trajectory curves from the camera
uniform float trajBMax;
uniform float trajPhiMax;
uniform sampler2D bbLut;    // blackbody colors, 1000..30000 K
uniform vec3 discN;         // disc plane basis in world space
uniform vec3 discU;
uniform vec3 discV;
uniform float discRIn;
uniform float discROut;
uniform float discAmt;
uniform float discDop;
uniform float discKel;
uniform float discSeed;

in vec3 vWorld;
out vec4 fragColor;

const float PI = 3.14159265;
const float B_CRIT = 2.598076211; // 3*sqrt(3)/2

// Hoskins-style hash: no transcendentals, so the streak pattern is stable
// across GPU vendors (sin-based hashes amplify implementation differences)
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5; float sum = 0.0;
  for (int k = 0; k < 4; k++) { sum += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return sum;
}

/**
 * Accretion disc via geodesic disc-plane crossings — the sprite baker's
 * algorithm in shader form. The pixel ray's orbital plane crosses the disc
 * plane at known swept angles phi_k = phi0 + pi/2 + k*pi; the radius there
 * is one trajectory-LUT fetch. Crossing 0 is the primary image (near side
 * straight, far side lensed into the hat), crossing 1 the inverted
 * secondary hugging the ring.
 */
vec3 discColor(vec3 dir, float theta) {
  if (discAmt <= 0.0) return vec3(0.0);
  // impact parameter of a ray through the camera at angle theta from a hole
  // at distance D: b = D sin(theta), with D = b_c / sin(thetaH)
  float b = (sin(theta) / sin(thetaH)) * B_CRIT;
  if (b >= trajBMax) return vec3(0.0);

  // orbital-plane basis: radial from BH toward the camera, tangential along
  // the view ray's transverse component
  vec3 radial = -bhDir;
  vec3 tang = dir - radial * dot(radial, dir);
  float tl = length(tang);
  if (tl < 1e-5) return vec3(0.0); // dead center: shadow anyway
  tang /= tl;

  float an = dot(radial, discN);
  float tn = dot(tang, discN);
  if (abs(an) + abs(tn) < 1e-5) return vec3(0.0); // grazing the disc plane
  float phi0 = atan(tn, an);

  float kf = ceil((0.06 - phi0 - 0.5 * PI) / PI);
  float light = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float phiK = phi0 + 0.5 * PI + (kf + float(i)) * PI;
    if (phiK >= trajPhiMax) break;
    vec2 tr = texture(trajLut, vec2(b / trajBMax, phiK / trajPhiMax)).rg;
    // validity < ~1 means bilinear touched a beyond-trajectory texel; the
    // held radius channel stays smooth but the crossing is not real there
    if (tr.g < 0.75) continue;
    float rho = tr.r;
    if (rho < discRIn || rho > discROut) continue;

    float env = smoothstep(discRIn, discRIn * 1.1, rho)
      * (1.0 - smoothstep(discROut * 0.82, discROut, rho));
    if (env <= 0.002) continue;

    // crossing point in world-oriented rs coordinates (BH at origin)
    vec3 q = radial * (rho * cos(phiK)) + tang * (rho * sin(phiK));

    // Keplerian Doppler: prograde orbit around discN; the photon reaching
    // the camera travels along -dir to first order
    vec3 orb = normalize(cross(discN, q));
    float vK = min(0.6, sqrt(0.5 / max(rho - 1.0, 1.0)));
    float mu = dot(orb, -dir);
    float gam = inversesqrt(1.0 - vK * vK);
    float delta = 1.0 / (gam * (1.0 - vK * mu));
    float dE = 1.0 + (delta - 1.0) * discDop;

    float g = sqrt(max(0.05, 1.0 - 1.0 / rho));
    // Doppler color: normalize the shift so the fully-approaching side peaks
    // AT discKel and the receding side falls toward ~discKel/10 at full
    // Doppler — the disc reads hot-blue incoming, cool-red outgoing
    float dMax = 1.0 / (gam * (1.0 - vK));
    float shift = pow(max(delta / dMax, 1e-3), 1.0 + 2.2 * discDop);
    float T = discKel * pow(discRIn / rho, 0.75);
    float Tobs = clamp(T * shift * g, 1000.0, 30000.0);
    vec3 col = texture(bbLut, vec2((Tobs - 1000.0) / 29000.0, 0.5)).rgb;

    // radius-twisted streaks (differential rotation)
    float ang = atan(dot(q, discV), dot(q, discU))
      + 2.6 * (rho - discRIn) / (discROut - discRIn);
    float kr = 1.4 + rho * 0.16;
    float fb = fbm(vec2(cos(ang), sin(ang)) * kr + discSeed);
    float density = 0.35 + 0.85 * pow(fb, 1.7);

    float I = discAmt * env * density * pow(discRIn / rho, 1.4)
      * dE * dE * dE * g * g * 3.2 * light;
    acc += col * I;
    light *= 0.55; // transmission through each successive disc pass
  }
  // soft shoulder so hot regions keep their hue instead of clipping white
  return acc * 1.55 / (1.0 + acc);
}

void main() {
  vec3 dir = normalize(vWorld);
  float cosT = clamp(dot(dir, bhDir), -1.0, 1.0);
  float theta = acos(cosT);

  // pixel angular footprint — every boundary below is AA'd against it
  float aaT = max(fwidth(theta), 1e-5);

  // beyond the bend region the quad is fully transparent — the REAL scene
  // shows through, so the footprint can never print a rectangle seam
  float fade = 1.0 - smoothstep(coverage * 0.55, coverage * 0.95, theta);
  if (fade <= 0.001) { discard; }

  // deflection: true Schwarzschild bend from the geodesic LUT inside
  // x = theta/thetaH < lutXMax (diverges toward the photon ring, where the
  // captured scene winds into ring imagery), analytic weak-field point-lens
  // beyond it. lutScale makes both branches identical in the weak field, so
  // there is no seam at the handoff.
  float x = sin(theta) / max(sin(thetaH), 1e-5); // = b / b_c, perspective-true
  float phi;
  if (x < lutXMax) {
    float u = clamp(sqrt(max(x - 1.0, 0.0) / (lutXMax - 1.0)), 0.0, 1.0);
    phi = lutScale * texture(deflLut, vec2(u, 0.5)).r;
  } else {
    phi = (thetaE * thetaE) / theta;
  }
  float beta = theta - phi;
  // taper the deflection to zero before the feather zone: otherwise the
  // bent image and the real sky show the same object twice at the edge
  phi *= 1.0 - smoothstep(coverage * 0.42, coverage * 0.88, theta);
  vec3 axis = cross(dir, bhDir);
  float axisLen = length(axis);
  vec3 bent = dir;
  if (axisLen > 1e-6) {
    axis /= axisLen;
    float c = cos(phi);
    float s = sin(phi);
    bent = dir * c + cross(axis, dir) * s + axis * dot(axis, dir) * (1.0 - c);
  }
  vec3 col = texture(bgCube, bent).rgb;

  // mild dimming of the wound (beta < 0) background images: physically the
  // higher-order images are fainter, and at full strength they crowd the ring
  float mirrorDim = mix(0.55, 1.0, smoothstep(-thetaH * 1.2, thetaH * 0.5, beta));
  col *= mirrorDim;

  // antialiased shadow boundary
  col *= smoothstep(thetaH - aaT * 1.5, thetaH + aaT * 1.5, theta);

  // photon ring just outside the horizon, sigma never below the pixel size
  col += vec3(1.0, 0.85, 0.6) * ringAmt
    * exp(-pow((theta - thetaH * 1.16) / max(thetaH * 0.09, aaT * 1.5), 2.0));

  // analytic accretion disc (primary + secondary geodesic images)
  col += discColor(dir, theta);

  // alpha feather to the true background (NormalBlending draws the real
  // scene wherever alpha < 1)
  fragColor = vec4(col, fade);
}
`;

// Geodesic deflection LUT: bend angle over x = b/b_c in (1, LUT_X_MAX],
// packed densely near the photon ring (u = sqrt((x-1)/(xMax-1))). The curve
// is in critical-impact-parameter units, so one texture serves every layer;
// built lazily once per session (pure math, deterministic).
const LUT_X_MAX = 9;
let lutTexture: THREE.DataTexture | null = null;

// half-float LUTs: linear filtering on full 32-bit float textures requires
// OES_texture_float_linear, which some mobile GPUs lack; half float linear
// is near-universal and the value ranges here fit comfortably
function toHalf(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = DataUtils.toHalfFloat(src[i]);
  return out;
}

function getDeflectionLutTexture(): THREE.DataTexture {
  if (!lutTexture) {
    const lut = buildDeflectionLut(256, LUT_X_MAX);
    lutTexture = new THREE.DataTexture(toHalf(lut), lut.length, 1, THREE.RedFormat, THREE.HalfFloatType);
    lutTexture.minFilter = THREE.LinearFilter;
    lutTexture.magFilter = THREE.LinearFilter;
    lutTexture.needsUpdate = true;
  }
  return lutTexture;
}

// Blackbody color LUT (1000..30000 K) from the same kelvinToRgb the rest of
// the app uses, so disc hues match star/sprite hues exactly.
let bbTexture: THREE.DataTexture | null = null;
function getBlackbodyLutTexture(): THREE.DataTexture {
  if (!bbTexture) {
    const n = 256;
    const data = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const rgb = kelvinToRgb(1000 + (29000 * i) / (n - 1));
      data[i * 4] = rgb.r; data[i * 4 + 1] = rgb.g; data[i * 4 + 2] = rgb.b;
      data[i * 4 + 3] = 1;
    }
    bbTexture = new THREE.DataTexture(toHalf(data), n, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    bbTexture.minFilter = THREE.LinearFilter;
    bbTexture.magFilter = THREE.LinearFilter;
    bbTexture.needsUpdate = true;
  }
  return bbTexture;
}

// Trajectory LUTs r(b, phi) depend on the camera->BH distance in rs (set by
// the shadow's apparent size), so they are cached per rounded distance.
const TRAJ_B_MAX = 28;
const TRAJ_PHI_MAX = 3 * Math.PI;
const trajCache = new Map<number, THREE.DataTexture>();
function getTrajectoryLutTexture(thetaH: number): THREE.DataTexture {
  const r0 = Math.min(200, Math.max(8, CRITICAL_B / Math.sin(thetaH)));
  const key = Math.round(r0 * 2);
  let tex = trajCache.get(key);
  if (!tex) {
    const lut = buildTrajectoryLut(key / 2, 384, 160, TRAJ_B_MAX, TRAJ_PHI_MAX);
    tex = new THREE.DataTexture(toHalf(lut.data), lut.nB, lut.nPhi, THREE.RGFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    // bound the MAP size only - never dispose() on eviction, an evicted
    // texture may still be referenced by a live material (three.js would
    // silently re-upload it and the cache would churn instead of help)
    if (trajCache.size > 12) {
      trajCache.delete(trajCache.keys().next().value as number);
    }
    trajCache.set(key, tex);
  }
  return tex;
}

export interface BlackHoleObject {
  group: THREE.Group;
  /**
   * Capture the background (everything except the lens quad) into bgCube.
   * pointScale compensates gl_PointSize star layers for the capture target's
   * resolution/FOV vs the view it will be composited into — without it the
   * lens footprint shows enlarged, washed-out stars against the real sky.
   */
  prepare: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, pointScale?: number) => void;
  /** drag support (undefined when the layer is locked) */
  placeable?: { mesh: THREE.Mesh; place: (lonDeg: number, latDeg: number) => void };
  dispose: () => void;
}

export function buildBlackHoleObject(
  layer: BlackHoleLayer,
  index: number,
  skyRadius: number,
  captureSize = 512,
): BlackHoleObject {
  const group = new THREE.Group();

  const lon = (layer.dirLonDeg * Math.PI) / 180;
  const lat = (layer.dirLatDeg * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.cos(lon),
  );

  const thetaH = Math.max(0.005, layer.apparentSize);
  const thetaE = thetaH * (1 + 1.8 * layer.lensStrength);
  // footprint covers both the bend region and the whole analytic disc
  const discThetaOut = layer.discAmount > 0
    ? Math.atan(Math.tan(thetaH) * layer.discOuter) * 1.15
    : 0;
  const coverage = Math.min(1.1, Math.max(
    Math.min(0.55, thetaE * 2.2 + thetaH * 2),
    discThetaOut,
  ));

  // background capture target
  const rt = new THREE.WebGLCubeRenderTarget(captureSize, {
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
  });
  const cubeCam = new THREE.CubeCamera(0.1, skyRadius * 4, rt);

  // disc plane basis in world space (no meshes — the disc is analytic in
  // the lens shader). Same orientation semantics as the old disc quad:
  // face the origin, spin about the view axis, tilt about the local x.
  const discN = new THREE.Vector3(0, 0, 1);
  const discU = new THREE.Vector3(1, 0, 0);
  const discV = new THREE.Vector3(0, 1, 0);
  const basisDummy = new THREE.Object3D();
  const computeDiscBasis = (): void => {
    basisDummy.position.copy(dir).multiplyScalar(skyRadius);
    basisDummy.lookAt(0, 0, 0);
    basisDummy.rotateZ((layer.discSpinDeg * Math.PI) / 180);
    basisDummy.rotateX((layer.discTiltDeg * Math.PI) / 180);
    discN.set(0, 0, 1).applyQuaternion(basisDummy.quaternion).normalize();
    discU.set(1, 0, 0).applyQuaternion(basisDummy.quaternion).normalize();
    discV.set(0, 1, 0).applyQuaternion(basisDummy.quaternion).normalize();
  };
  computeDiscBasis();

  // lens quad: covers the lens footprint, replaces background inside it
  const quadHalf = Math.tan(coverage) * skyRadius * 0.97;
  const lensGeo = new THREE.PlaneGeometry(quadHalf * 2, quadHalf * 2);
  const lensMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: LENS_VERT,
    fragmentShader: LENS_FRAG,
    uniforms: {
      bgCube: { value: rt.texture },
      deflLut: { value: getDeflectionLutTexture() },
      bhDir: { value: dir },
      thetaH: { value: thetaH },
      thetaE: { value: thetaE },
      coverage: { value: coverage },
      ringAmt: { value: layer.photonRing },
      lutScale: { value: (thetaE * thetaE * CRITICAL_B) / (2 * thetaH) },
      lutXMax: { value: LUT_X_MAX },
      trajLut: { value: getTrajectoryLutTexture(thetaH) },
      trajBMax: { value: TRAJ_B_MAX },
      trajPhiMax: { value: TRAJ_PHI_MAX },
      bbLut: { value: getBlackbodyLutTexture() },
      discN: { value: discN },
      discU: { value: discU },
      discV: { value: discV },
      discRIn: { value: layer.discInner * CRITICAL_B },
      discROut: { value: layer.discOuter * CRITICAL_B },
      discAmt: { value: layer.discAmount },
      discDop: { value: layer.discDoppler },
      discKel: { value: layer.discKelvin },
      discSeed: { value: (layer.seed >>> 0) % 977 },
    },
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.NormalBlending,
  });
  const lensMesh = new THREE.Mesh(lensGeo, lensMat);
  lensMesh.position.copy(dir).multiplyScalar(skyRadius * 0.97);
  lensMesh.lookAt(0, 0, 0);
  lensMesh.renderOrder = index + 0.5;
  lensMesh.frustumCulled = false;
  group.add(lensMesh);

  // invisible drag/pick proxy covering the lens footprint
  const proxyGeo = new THREE.PlaneGeometry(quadHalf * 2, quadHalf * 2);
  const proxyMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true });
  const proxy = new THREE.Mesh(proxyGeo, proxyMat);
  proxy.position.copy(dir).multiplyScalar(skyRadius * 0.9);
  proxy.lookAt(0, 0, 0);
  proxy.renderOrder = -1;
  proxy.frustumCulled = false;
  group.add(proxy);

  /**
   * Re-aim everything at a new sky direction. Mutating `dir` in place also
   * updates the lens shader's bhDir uniform (it holds this vector). The lens
   * shows its stale capture while dragging; the commit-time rebuild
   * re-captures at the new position.
   */
  const place = (lonDeg: number, latDeg: number) => {
    const lon = (lonDeg * Math.PI) / 180;
    const lat = (latDeg * Math.PI) / 180;
    dir.set(
      Math.cos(lat) * Math.sin(lon),
      Math.sin(lat),
      -Math.cos(lat) * Math.cos(lon),
    );
    lensMesh.position.copy(dir).multiplyScalar(skyRadius * 0.97);
    lensMesh.lookAt(0, 0, 0);
    proxy.position.copy(dir).multiplyScalar(skyRadius * 0.9);
    proxy.lookAt(0, 0, 0);
    computeDiscBasis();
  };

  return {
    group,
    placeable: layer.locked ? undefined : { mesh: proxy, place },
    prepare: (renderer, scene, pointScale = 1) => {
      lensMesh.visible = false;
      const scaled: Array<{ u: { value: number }; orig: number }> = [];
      if (pointScale !== 1) {
        scene.traverse((o) => {
          if (o instanceof THREE.Points) {
            const u = (o.material as THREE.ShaderMaterial).uniforms?.sizeScale;
            if (u) {
              scaled.push({ u, orig: u.value as number });
              u.value = (u.value as number) * pointScale;
            }
          }
        });
      }
      cubeCam.position.set(0, 0, 0);
      cubeCam.update(renderer, scene);
      for (const { u, orig } of scaled) u.value = orig;
      lensMesh.visible = true;
    },
    dispose: () => {
      lensGeo.dispose();
      lensMat.dispose();
      proxyGeo.dispose();
      proxyMat.dispose();
      rt.dispose();
    },
  };
}
