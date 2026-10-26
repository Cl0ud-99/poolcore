#version 300 es
precision highp float;
precision highp int;

in vec2 vUV;
out vec4 oColor;

uniform sampler2D uDepth;
uniform sampler2D uNormal;
uniform sampler2D uLit;
uniform mat4 uVP;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec2 uRes;
uniform float uFrame;
uniform float uMaxDist;
uniform float uStrength;
uniform float uThick;

vec3 worldAt(vec2 uv, float d) {
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 w = uInvVP * c; w /= w.w;
  return w.xyz;
}

void main() {
  float d = texture(uDepth, vUV).r;
  if (d >= 0.99999) { oColor = vec4(0.0, 0.0, 0.0, 0.0); return; }
  vec3 P = worldAt(vUV, d);
  vec3 N = octDecode(texture(uNormal, vUV).xy * 2.0 - 1.0);

  vec3 up = abs(N.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);

  float rot = ign(gl_FragCoord.xy + vec2(uFrame * 13.7, uFrame * 7.1)) * 6.2831853;

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  const int NS = 8;
  for (int i = 0; i < NS; i++) {
    float fi = float(i);
    float a = rot + fi * 2.39996323;
    float rr = sqrt((fi + 0.62) / float(NS));
    float sinT = rr * 0.94;
    float cosT = sqrt(max(0.0, 1.0 - sinT * sinT));
    vec3 dir = normalize(T * cos(a) * sinT + B * sin(a) * sinT + N * cosT);

    float t = 0.22;
    float hitT = -1.0;
    vec2 hitUV = vec2(0.0);
    // 16 steps instead of 26. GI is blurred twice before use, so the extra march
    // resolution only refined detail that the blur then discarded.
    for (int j = 0; j < 16; j++) {
      t += 0.34 + t * 0.38;
      if (t > uMaxDist) break;
      // Beyond ~12 m the contribution is already faded out by distFade, so there
      // is no point continuing to march.
      if (t > uMaxDist * 0.68) break;
      vec3 Q = P + dir * t;
      vec4 cp = uVP * vec4(Q, 1.0);
      if (cp.w <= 0.0) break;
      vec2 uv = cp.xy / cp.w * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float dz = texture(uDepth, uv).r;
      if (dz >= 0.99999) continue;
      vec3 sp = worldAt(uv, dz);
      float diff = length(sp - uCamPos) - length(Q - uCamPos);
      if (diff < -0.015 && diff > -(uThick + t * 0.12)) {
        hitT = t; hitUV = uv; break;
      }
    }
    if (hitT > 0.0) {
      vec3 rad = texture(uLit, hitUV).rgb;
      float edge = smoothstep(0.0, 0.11, min(min(hitUV.x, 1.0 - hitUV.x), min(hitUV.y, 1.0 - hitUV.y)));
      float distFade = 1.0 - smoothstep(uMaxDist * 0.55, uMaxDist, hitT);
      float w = edge * distFade;
      acc += rad * w; wsum += w;
    }
  }
  // Do NOT renormalise by the number of rays that happened to hit: with six
  // rays a patch where one ray finds the bright floor and five miss comes out
  // as full-brightness GI, and the neighbouring patch where none hit is black.
  // That binary hit/miss pattern was the brown blotching on the vault soffit.
  // Dividing by the ray count makes coverage a smooth weight instead.
  vec3 gi = acc / float(NS);
  oColor = vec4(gi * uStrength, clamp(wsum / float(NS), 0.0, 1.0));
}