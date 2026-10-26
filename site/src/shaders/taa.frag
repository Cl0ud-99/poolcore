#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oColor;
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform sampler2D uDepth;
uniform sampler2D uPrevDepth;
uniform mat4 uInvVP;
uniform mat4 uPrevVP;
uniform vec2 uRes;
uniform float uBlend;
uniform float uFirst;

vec3 worldAt(vec2 uv, float d) {
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 w = uInvVP * c; w /= w.w;
  return w.xyz;
}

void main() {
  vec3 cur = texture(uCur, vUV).rgb;
  if (uFirst > 0.5) { oColor = vec4(cur, 1.0); return; }

  float d = texture(uDepth, vUV).r;
  vec3 P = worldAt(vUV, d);
  vec4 pc = uPrevVP * vec4(P, 1.0);
  vec2 puv = pc.xy / max(pc.w, 1e-5) * 0.5 + 0.5;

  if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0 || pc.w <= 0.0) {
    oColor = vec4(cur, 1.0);
    return;
  }

  float dp = texture(uPrevDepth, puv).r;
  vec3 Pprev = worldAt(puv, dp);
  float dz = abs(Pprev.z - P.z) / max(abs(P.z), 0.5);
  float valid = 1.0 - smoothstep(0.01, 0.06, dz);
  valid *= step(0.0001, d) * step(0.0001, dp);

  // Neighbourhood clamp against the current frame, used to kill ghosting.
  //
  // A plain 3x3 min/max box is too tight: on any edge the history is forced into
  // a range that excludes it, so blending contributes nothing and the edge keeps
  // its stair-step forever. The fix is the standard one - clamp to the
  // neighbourhood mean +/- k*sigma, which still rejects genuinely stale history
  // but leaves room for a sub-pixel shift to survive.
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = texture(uCur, vUV + vec2(float(x), float(y)) / uRes).rgb;
      m1 += c;
      m2 += c * c;
    }
  }
  m1 /= 9.0;
  m2 /= 9.0;
  vec3 sigma = sqrt(max(m2 - m1 * m1, vec3(0.0)));
  // 1.25 sigma is wide enough to keep a moving edge, tight enough to kill trails.
  vec3 lo = m1 - sigma * 1.25;
  vec3 hi = m1 + sigma * 1.25;

  vec3 prev = texture(uPrev, puv).rgb;
  prev = clamp(prev, lo, hi);

  float blend = uBlend * valid;
  oColor = vec4(mix(cur, prev, blend), 1.0);
}
