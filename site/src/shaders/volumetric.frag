#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oCol;

uniform sampler2D uDepth;
uniform sampler2D uShadowMap;
uniform mat4 uShadowVP;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec2 uRes;
uniform float uFrame;
uniform float uDensity;
uniform float uMaxDist;
uniform float uAniso;
uniform float uScatter;
uniform float uHazeY;
uniform float uVolMode;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float shadowAt(vec3 p) {
  vec4 sp = uShadowVP * vec4(p, 1.0);
  vec3 c = sp.xyz / sp.w * 0.5 + 0.5;
  if (c.x < 0.002 || c.x > 0.998 || c.y < 0.002 || c.y > 0.998 || c.z > 1.0) return 1.0;
  // The shadow map is a 1..170 ortho depth range, so 0.0022 in normalised depth
  // is 37 cm of world space. That bias was swallowing every beam and turning the
  // shafts into one flat blob; 0.00025 is ~4 cm, which still hides acne.
  float b = 0.00025;
  vec2 ts = 1.0 / vec2(textureSize(uShadowMap, 0));
  // Two taps instead of four. The volumetric pass jitters its start point every
  // frame and the result is blurred by TAA, so the extra pair only removed noise
  // that is already being averaged out - at 32 steps that is 64 fewer fetches per
  // pixel.
  float s = step(c.z - b, texture(uShadowMap, c.xy).r);
  s += step(c.z - b, texture(uShadowMap, c.xy + ts * 0.5).r);
  return s * 0.5;
}

void main() {
  float d = texture(uDepth, vUV).r;
  vec4 wp = uInvVP * vec4(vUV * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 world = wp.xyz / wp.w;
  vec3 rd = normalize(world - uCamPos);
  float sceneDist = d >= 0.99999 ? uMaxDist : min(length(world - uCamPos), uMaxDist);

  // 32 steps instead of 64. The integrand is a slowly varying shadow lookup, and
  // the per-frame jitter dithers the remaining banding away, so half the samples
  // is visually free. This is the single most expensive loop in the frame.
  const int STEPS = 32;
  float jitter = hash12(vUV * uRes + uFrame * 7.13);
  float dt = sceneDist / float(STEPS);

  float cosT = clamp(dot(rd, uSunDir), -1.0, 1.0);
  float g = uAniso;
  float gg = 1.0 + g * g - 2.0 * g * cosT;
  float phase = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(gg, 1e-4), 1.5));
  // A near-isotropic lobe lifts the whole frame by the same amount and is what
  // made every volumetric test read as "hazy wash" instead of "light shaft".
  // Biasing hard toward forward scattering keeps the air dark everywhere except
  // where the view ray actually runs along a sunbeam.
  phase = mix(1.0 / (4.0 * 3.14159265), phase, 0.93) * uScatter;

  // Optical depth of the *lit* part of the ray. Kept dimensionless (0..~40) so
  // the artist-facing uDensity stays a 0..1 haze knob and SIGMA_S below is the
  // only place a physical scattering coefficient lives.
  float acc = 0.0;
  float t = dt * jitter;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = uCamPos + rd * t;
    // haze is thicker in the low band above the water, thinner up in the vault
    float hf = exp(-max(p.y - uHazeY, 0.0) * 0.16);
    acc += shadowAt(p) * (0.10 + 0.90 * hf) * dt;
    t += dt;
  }
  // Single-scattered sun shafts. The previous version folded uDensity into the
  // integral and then multiplied by the (very bright) sun colour, which put the
  // result around 1e3 in HDR - every beam read as a white wall of fog. Splitting
  // the integral from the scattering coefficient keeps the shafts readable and
  // lets them stay near 0.1..2.0 where ACES has room for them.
  // Calibrated so that a fully lit forward-scattering shaft lands near 1.0 in
  // HDR at the default uDensity (0.30); below that ACES keeps the beam readable
  // instead of clipping it to flat white.
  const float SIGMA_S = 0.0150;
  vec3 col = uSunColor * acc * phase * (SIGMA_S * uDensity);
  if (uVolMode > 0.5 && uVolMode < 1.5) { oCol = vec4(vec3(acc / max(sceneDist, 1.0)), 1.0); return; }
  if (uVolMode > 1.5 && uVolMode < 2.5) { oCol = vec4(vec3(acc * 0.02), 1.0); return; }
  if (uVolMode > 2.5 && uVolMode < 3.5) { oCol = vec4(vec3(phase * 0.25), 1.0); return; }
  if (uVolMode > 3.5 && uVolMode < 4.5) { oCol = vec4(vec3(shadowAt(uCamPos + rd * sceneDist * 0.5)), 1.0); return; }
  if (uVolMode > 4.5 && uVolMode < 5.5) {
    vec4 sp = uShadowVP * vec4(uCamPos + rd * sceneDist * 0.5, 1.0);
    vec3 c = sp.xyz / sp.w * 0.5 + 0.5;
    oCol = vec4(c, 1.0); return;
  }
  if (uVolMode > 5.5) { oCol = vec4(texture(uShadowMap, vUV).rrr, 1.0); return; }
  oCol = vec4(col, 1.0);
}
