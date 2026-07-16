/**
 * Black hole distortion layer: a lens quad that replaces the sky behind it
 * with a gravitationally-bent sample of a background cubemap (captured from
 * the scene with the lens hidden), plus a photon ring and an additive
 * accretion disc. The disc is captured too, so its far side is bent over the
 * hole — the classic "hat" — for free.
 */
import * as THREE from 'three';
import { kelvinToRgb } from '../core/blackbody';
import { CRITICAL_B, buildDeflectionLut } from '../gen/geodesic';
import type { BlackHoleLayer } from '../core/layers';
import { applyBlend } from './blend';

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

in vec3 vWorld;
out vec4 fragColor;

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
  float x = theta / max(thetaH, 1e-5);
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

  // mild dimming of the wound (beta < 0) images: with true geodesic bending
  // these are genuine far-side imagery, but physically the higher-order
  // images are fainter, and at full strength they crowd the photon ring
  float mirrorDim = mix(0.55, 1.0, smoothstep(-thetaH * 1.2, thetaH * 0.5, beta));
  col *= mirrorDim;

  // antialiased shadow boundary (replaces the old hard branch at thetaH)
  col *= smoothstep(thetaH - aaT * 1.5, thetaH + aaT * 1.5, theta);

  // photon ring just outside the horizon, sigma never below the pixel size
  col += vec3(1.0, 0.85, 0.6) * ringAmt
    * exp(-pow((theta - thetaH * 1.16) / max(thetaH * 0.09, aaT * 1.5), 2.0));

  // alpha feather to the true background (NormalBlending draws the real
  // scene wherever alpha < 1)
  fragColor = vec4(col, fade);
}
`;

const DISC_VERT = /* glsl */ `
out vec2 vLocal;  // disc-plane coords in shadow-radius units
out vec3 vWorld;  // world position (camera is at the origin)

uniform float horizonWorld;

void main() {
  vLocal = position.xy / horizonWorld;
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DISC_FRAG = /* glsl */ `
precision highp float;

// Physical disc shading, mirroring the geodesic PCG sprite baker:
// T ~ r^-0.75 Novikov-Thorne profile via a blackbody LUT, Keplerian Doppler
// with relativistic beaming, gravitational redshift, and radius-twisted FBM
// density for differential-rotation streaks. The lens quad captures and
// bends this disc, so the far-side hat and ring imagery emerge downstream.

uniform sampler2D bbLut;    // blackbody colors, 1000..30000 K
uniform vec3 discCenter;    // BH center in world space
uniform vec3 discNormal;    // disc plane normal in world space
uniform float innerR;       // shadow radii
uniform float outerR;
uniform float amount;
uniform float doppler;
uniform float kelvin;       // temperature at the inner edge
uniform float seedOff;      // per-layer streak pattern offset

in vec2 vLocal;
in vec3 vWorld;
out vec4 fragColor;

const float B_CRIT = 2.598076211;  // rs per shadow radius (3*sqrt(3)/2)

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
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

void main() {
  float r = length(vLocal);
  if (r < innerR || r > outerR) discard;
  float rs = r * B_CRIT; // radius in Schwarzschild radii

  float env = smoothstep(innerR, innerR * 1.1, r)
    * (1.0 - smoothstep(outerR * 0.82, outerR, r));

  // Keplerian Doppler: material orbits prograde around the disc normal;
  // the camera sits at the world origin
  vec3 rel = vWorld - discCenter;
  vec3 orb = normalize(cross(discNormal, rel));
  vec3 toCam = -normalize(vWorld);
  float vK = min(0.6, sqrt(0.5 / max(rs - 1.0, 1.0)));
  float mu = dot(orb, toCam);
  float gam = inversesqrt(1.0 - vK * vK);
  float delta = 1.0 / (gam * (1.0 - vK * mu));
  float dE = 1.0 + (delta - 1.0) * doppler;

  // gravitational redshift + temperature profile -> blackbody color
  float g = sqrt(max(0.05, 1.0 - 1.0 / rs));
  float T = kelvin * pow(innerR / r, 0.75);
  float Tobs = clamp(T * dE * g, 1000.0, 30000.0);
  vec3 col = texture(bbLut, vec2((Tobs - 1000.0) / 29000.0, 0.5)).rgb;

  // radius-twisted streaks (differential rotation)
  float ang = atan(vLocal.y, vLocal.x) + 2.6 * (r - innerR) / (outerR - innerR);
  float kr = 1.4 + rs * 0.16;
  float fb = fbm(vec2(cos(ang), sin(ang)) * kr + seedOff);
  float density = 0.35 + 0.85 * pow(fb, 1.7);

  // gentler radial falloff than the sprite baker: at layer scale the broad
  // disc is the readable feature, and the lens compresses it further
  float I = amount * env * density * pow(innerR / r, 1.4)
    * dE * dE * dE * g * g * 3.2;
  vec3 c = col * I;
  // soft shoulder (same as the sprite baker) so hot regions keep their hue
  c = c * 1.55 / (1.0 + c);
  fragColor = vec4(c, 1.0);
}
`;

// Geodesic deflection LUT: bend angle over x = b/b_c in (1, LUT_X_MAX],
// packed densely near the photon ring (u = sqrt((x-1)/(xMax-1))). The curve
// is in critical-impact-parameter units, so one texture serves every layer;
// built lazily once per session (pure math, deterministic).
const LUT_X_MAX = 9;
let lutTexture: THREE.DataTexture | null = null;

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
    bbTexture = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat, THREE.FloatType);
    bbTexture.minFilter = THREE.LinearFilter;
    bbTexture.magFilter = THREE.LinearFilter;
    bbTexture.needsUpdate = true;
  }
  return bbTexture;
}
function getDeflectionLutTexture(): THREE.DataTexture {
  if (!lutTexture) {
    const lut = buildDeflectionLut(256, LUT_X_MAX);
    lutTexture = new THREE.DataTexture(lut, lut.length, 1, THREE.RedFormat, THREE.FloatType);
    lutTexture.minFilter = THREE.LinearFilter;
    lutTexture.magFilter = THREE.LinearFilter;
    lutTexture.needsUpdate = true;
  }
  return lutTexture;
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
  // tighter footprint + a wider edge fade: the rectangle seam came from a
  // huge lens quad whose blurred capture mismatched the crisp sky
  const coverage = Math.min(0.55, thetaE * 2.2 + thetaH * 2);

  // background capture target
  const rt = new THREE.WebGLCubeRenderTarget(captureSize, {
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
  });
  const cubeCam = new THREE.CubeCamera(0.1, skyRadius * 4, rt);

  // accretion disc (drawn beneath the lens quad so the capture includes it)
  let discMesh: THREE.Mesh | null = null;
  let discMat: THREE.ShaderMaterial | null = null;
  let discGeo: THREE.PlaneGeometry | null = null;
  const horizonWorld = thetaH * skyRadius;
  if (layer.discAmount > 0) {
    const discWorld = layer.discOuter * horizonWorld;
    discGeo = new THREE.PlaneGeometry(discWorld * 2.1, discWorld * 2.1);
    discMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: DISC_VERT,
      fragmentShader: DISC_FRAG,
      uniforms: {
        horizonWorld: { value: horizonWorld },
        bbLut: { value: getBlackbodyLutTexture() },
        discCenter: { value: new THREE.Vector3() }, // synced below + on place
        discNormal: { value: new THREE.Vector3(0, 0, 1) },
        innerR: { value: layer.discInner },
        outerR: { value: layer.discOuter },
        amount: { value: layer.discAmount },
        doppler: { value: layer.discDoppler },
        kelvin: { value: layer.discKelvin },
        seedOff: { value: (layer.seed >>> 0) % 977 },
      },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    applyBlend(discMat, 'one', 'one');
    discMesh = new THREE.Mesh(discGeo, discMat);
    discMesh.position.copy(dir).multiplyScalar(skyRadius * 0.94);
    // orient: start facing the origin, then tilt/spin the disc plane
    discMesh.lookAt(0, 0, 0);
    discMesh.rotateZ((layer.discSpinDeg * Math.PI) / 180);
    // tilt 0 = face-on ring, 90 = edge-on line
    discMesh.rotateX((layer.discTiltDeg * Math.PI) / 180);
    discMesh.renderOrder = index;
    discMesh.frustumCulled = false;
    group.add(discMesh);
  }

  // the disc shader needs the plane's world center + normal for the Doppler
  // geometry; recompute after every (re)orientation
  const syncDiscFrame = (): void => {
    if (!discMesh || !discMat) return;
    discMesh.updateMatrixWorld();
    (discMat.uniforms.discCenter.value as THREE.Vector3).copy(discMesh.position);
    (discMat.uniforms.discNormal.value as THREE.Vector3)
      .set(0, 0, 1).applyQuaternion(discMesh.quaternion).normalize();
  };
  syncDiscFrame();

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
    if (discMesh) {
      discMesh.position.copy(dir).multiplyScalar(skyRadius * 0.94);
      discMesh.lookAt(0, 0, 0);
      discMesh.rotateZ((layer.discSpinDeg * Math.PI) / 180);
      discMesh.rotateX((layer.discTiltDeg * Math.PI) / 180);
      syncDiscFrame();
    }
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
      discGeo?.dispose();
      discMat?.dispose();
      proxyGeo.dispose();
      proxyMat.dispose();
      rt.dispose();
    },
  };
}
