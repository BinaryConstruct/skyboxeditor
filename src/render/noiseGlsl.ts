/**
 * GPU noise shaders, ported from the GLSL embedded in
 * SpacescapeNoiseMaterial.cpp to GLSL ES 3.00 (three.js `glslVersion: GLSL3`).
 *
 * Parity notes:
 * - The GPU path uses Perlin's standard t^3 fade curve (the original CPU path
 *   had a t^4 quirk; the two never matched — GPU is the canonical look).
 * - permTexture (256x256 RGBA) and gradTexture (256x1) must be sampled with
 *   NEAREST filtering and REPEAT wrapping (TFO_NONE / TAM_WRAP in the
 *   original) or the hash lookups break.
 * - texture1D(gradTexture, x) becomes a 256x1 2D texture sampled at (x, 0.5).
 * - Alpha output carries the raw noise value; mask layers depend on it.
 */

export const NOISE_VERT = /* glsl */ `
out vec3 vertexPos;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vertexPos = normalize(position);
}
`;

/** Shared noise library: uniforms + perlin/fbm/ridged/warp helpers. */
const NOISE_COMMON = /* glsl */ `
precision highp float;

uniform sampler2D permTexture;
uniform sampler2D gradTexture;
uniform float ditherAmt;
uniform float gain;
uniform vec3 innerColor;
uniform float lacunarity;
uniform float offset;
uniform int octaves;
uniform vec3 outerColor;
uniform float powerAmt;
uniform float shelfAmt;
uniform float noiseScale;
uniform bool ridgedNoise;
uniform float warpStrength;
uniform float warpScale;
uniform bool useRamp;
uniform sampler2D rampTexture;
uniform float hdrPowerAmt;
uniform float hdrMultiplierAmt;

in vec3 vertexPos;
out vec4 fragColor;

vec3 fade(vec3 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

vec4 perm2d(vec2 p) {
  return texture(permTexture, p);
}

float gradperm(float x, vec3 p) {
  vec3 v = texture(gradTexture, vec2(x, 0.5)).xyz;
  v = v * 2.0 - 1.0;
  return dot(v, p);
}

// noise values returned are between -1.0 and 1.0
float perlinNoise(vec3 p) {
  vec3 P = mod(floor(p), 256.0);
  p -= floor(p);
  vec3 f = fade(p);

  P = P / 256.0;

  // hash coordinates of the 8 cube corners
  vec4 AA = perm2d(P.xy) + P.z;

  // and add blended results from the 8 corners of the cube
  return mix(
    mix(mix(gradperm(AA.x, p),
            gradperm(AA.z, p + vec3(-1, 0, 0)), f.x),
        mix(gradperm(AA.y, p + vec3(0, -1, 0)),
            gradperm(AA.w, p + vec3(-1, -1, 0)), f.x), f.y),
    mix(mix(gradperm(AA.x + (1.0 / 256.0), p + vec3(0, 0, -1)),
            gradperm(AA.z + (1.0 / 256.0), p + vec3(-1, 0, -1)), f.x),
        mix(gradperm(AA.y + (1.0 / 256.0), p + vec3(0, -1, -1)),
            gradperm(AA.w + (1.0 / 256.0), p + vec3(-1, -1, -1)), f.x), f.y),
    f.z);
}

float fbmNoise(vec3 vIn, int octs, float lac, float g) {
  vec3 v = vIn;
  float noiseSum = 0.0;
  float amplitude = 1.0;
  float amplitudeSum = 0.0;

  for (int i = 0; i < octs; i++) {
    noiseSum += perlinNoise(v) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= g;
    v *= lac;
  }

  return noiseSum / amplitudeSum;
}

float ridge(float noiseVal, float off) {
  float newVal = off - abs(noiseVal);
  return newVal * newVal;
}

float ridgedFbmNoise(vec3 vIn, int octs, float lac, float g, float off) {
  vec3 v = vIn;
  float noiseSum = 0.0;
  float amplitude = 1.0;
  float amplitudeSum = 0.0;
  float prev = 1.0;
  float n;

  for (int i = 0; i < octs; i++) {
    n = ridge(perlinNoise(v), off);
    noiseSum += n * amplitude * prev;
    prev = n;
    amplitudeSum += amplitude;
    amplitude *= g;
    v *= lac;
  }

  return noiseSum / amplitudeSum;
}

/** Vector-valued FBM for domain warping (three decorrelated offsets). */
vec3 fbm3(vec3 p, int octs, float lac, float g) {
  return vec3(
    fbmNoise(p, octs, lac, g),
    fbmNoise(p + vec3(123.4, 567.8, 901.2), octs, lac, g),
    fbmNoise(p + vec3(314.1, 159.2, 653.5), octs, lac, g));
}
`;

export const NOISE_FRAG = /* glsl */ `${NOISE_COMMON}
void main(void) {
  vec3 v = normalize(vertexPos);
  float noiseSum;

  // Domain warp (Quilez): fbm(p + k*fbm3(p)). Guarded so warpStrength == 0
  // is bit-identical to the legacy pipeline.
  if (warpStrength != 0.0) {
    v += warpStrength * fbm3(v * warpScale * noiseScale, min(octaves, 4), lacunarity, gain);
  }

  if (ridgedNoise) {
    noiseSum = ridgedFbmNoise(noiseScale * v, octaves, lacunarity, gain, offset)
             + ridgedFbmNoise(v * 10000.0, octaves, lacunarity, gain, offset) * ditherAmt;
  } else {
    noiseSum = fbmNoise(noiseScale * v, octaves, lacunarity, gain)
             + fbmNoise(v * 10000.0, 2, lacunarity, gain) * ditherAmt;
  }

  // get noiseSum in range 0..1
  noiseSum = (noiseSum * 0.5) + 0.5;

  // apply shelf, scale what survives back into 0..1 (guard shelf == 1)
  noiseSum = max(0.0, noiseSum - shelfAmt);
  noiseSum *= 1.0 / max(1.0 - shelfAmt, 0.001);

  // apply optional power function
  noiseSum = pow(noiseSum, 1.0 / powerAmt);

  // upstream 0.5.x HDR shaping (guarded for bit parity at defaults)
  if (hdrPowerAmt != 1.0) {
    noiseSum = pow(noiseSum, hdrPowerAmt);
  }

  // multi-stop ramp LUT when set; exact legacy two-color mix otherwise
  vec3 color = useRamp
    ? texture(rampTexture, vec2(noiseSum, 0.5)).rgb
    : mix(outerColor, innerColor, noiseSum);
  fragColor = vec4(color, noiseSum) * hdrMultiplierAmt;
}
`;

/**
 * Pseudo-volumetric nebula: raymarch a warped-noise density shell with
 * emissive accumulation and Beer-Lambert absorption. Output is
 * premultiplied-style (accumulated emission, alpha = 1 - transmittance), so
 * the natural layer blend is one / one_minus_src_alpha.
 */
export const VOLUME_FRAG = /* glsl */ `${NOISE_COMMON}
uniform int volSteps;
uniform float volDensity;
uniform float volAbsorption;
uniform float shellInner;
uniform float shellOuter;

float sampleDensity(vec3 p) {
  vec3 q = p * noiseScale;
  if (warpStrength != 0.0) {
    q += warpStrength * fbm3(q * warpScale, min(octaves, 4), lacunarity, gain);
  }
  float n = ridgedNoise
    ? ridgedFbmNoise(q, octaves, lacunarity, gain, offset)
    : fbmNoise(q, octaves, lacunarity, gain);
  n = n * 0.5 + 0.5;
  n = max(0.0, n - shelfAmt) / max(1.0 - shelfAmt, 0.001);
  n = pow(n, 1.0 / powerAmt);
  // upstream-style HDR power shaping (no-op at the default)
  if (hdrPowerAmt != 1.0) {
    n = pow(n, hdrPowerAmt);
  }
  return n;
}

void main(void) {
  vec3 dir = normalize(vertexPos);

  float dt = (shellOuter - shellInner) / float(volSteps);
  // per-ray jitter hides banding without a real dither texture
  float jitter = fract(sin(dot(dir.xy, vec2(12.9898, 78.233)) + dir.z * 37.719) * 43758.5453);

  vec3 accum = vec3(0.0);
  float transmittance = 1.0;

  for (int i = 0; i < volSteps; i++) {
    float t = shellInner + (float(i) + jitter) * dt;
    vec3 p = dir * t;
    float n = sampleDensity(p);
    float d = n * volDensity * dt;

    vec3 emit = useRamp
      ? texture(rampTexture, vec2(n, 0.5)).rgb
      : mix(outerColor, innerColor, n);

    accum += transmittance * emit * d;
    transmittance *= exp(-d * volAbsorption);
    if (transmittance < 0.003) break;
  }

  fragColor = vec4(accum * hdrMultiplierAmt, 1.0 - transmittance);
}
`;

/** Point-star shader: per-vertex size (gl_PointSize) and RGBA color. */
export const POINTS_VERT = /* glsl */ `
in float aSize;
in vec4 aColor;
uniform float sizeScale;
out vec4 vColor;

void main() {
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * sizeScale;
}
`;

export const POINTS_FRAG = /* glsl */ `
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
  // round stars with a gaussian profile: derivative-continuous, so no
  // visible falloff ring; fwidth-based edge AA instead of a hard discard
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float aa = max(fwidth(r), 1e-4);
  float edge = 1.0 - smoothstep(1.0 - aa, 1.0, r);
  if (edge <= 0.0) discard;
  float prof = exp(-3.5 * r * r);
  // ±1/2 LSB screen-space dither breaks 8-bit banding in the dim skirts
  float dith = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  fragColor = vColor * (prof * edge) + vec4(dith, dith, dith, 0.0);
}
`;

/** Trivial cubemap-sampling skybox shader used to composite noise layers. */
export const SKY_VERT = /* glsl */ `
out vec3 vDir;

void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
precision highp float;

uniform samplerCube cubeMap;
in vec3 vDir;
out vec4 fragColor;

void main() {
  fragColor = texture(cubeMap, normalize(vDir));
}
`;

/** Fullscreen pass converting a cubemap to an equirectangular projection. */
export const EQUIRECT_VERT = /* glsl */ `
out vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const EQUIRECT_FRAG = /* glsl */ `
precision highp float;

uniform samplerCube cubeMap;
in vec2 vUv;
out vec4 fragColor;

void main() {
  float lon = vUv.x * 6.28318530718 - 3.14159265359;
  float lat = (vUv.y - 0.5) * 3.14159265359;
  vec3 dir = vec3(cos(lat) * sin(lon), sin(lat), -cos(lat) * cos(lon));
  fragColor = vec4(texture(cubeMap, dir).rgb, 1.0);
}
`;
