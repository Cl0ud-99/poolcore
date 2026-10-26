#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oColor;
uniform sampler2D uDepth;
uniform sampler2D uNormal;
uniform mat4 uVP;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec2 uRes;
uniform float uRadius;

vec3 worldAt(vec2 uv, float d) {
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 w = uInvVP * c; w /= w.w;
  return w.xyz;
}

void main() {
  float d = texture(uDepth, vUV).r;
  if (d >= 0.99999) { oColor = vec4(1.0); return; }
  vec3 P = worldAt(vUV, d);
  vec3 N = octDecode(texture(uNormal, vUV).xy * 2.0 - 1.0);
  float dist = length(P - uCamPos);

  float radius = clamp(uRadius, 0.08, dist * 0.6);
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  vec3 up = abs(N.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);

  // 16 taps instead of 24. The result is blurred by two separable passes
  // immediately afterwards, which removes exactly the noise the extra taps were
  // there to suppress.
  const int NS = 16;
  float occ = 0.0;
  float valid = 0.0;
  float bias = 0.012 + 0.006 * dist;

  for (int i = 0; i < NS; i++) {
    float fi = float(i);
    float a = rot + fi * 2.39996323;
    // NOTE: 'dir' must be a unit vector and the sample is placed at dir * r.
    // The previous code normalised the vector *after* scaling it by r, so every
    // sample landed exactly 1 m away no matter what uRadius said - which is why
    // the AO radius knob only changed overall darkness and why a 0.28 m torus
    // tube picked up occlusion from the ring 0.6 m above it as hard bands.
    float r = radius * sqrt((fi + 0.65) / float(NS));
    float h = 0.35 + 0.65 * (fi / float(NS));
    vec3 dir = normalize(T * cos(a) + B * sin(a) + N * h);
    vec3 sp = P + N * bias + dir * r;
    vec4 cp = uVP * vec4(sp, 1.0);
    vec2 suv = cp.xy / cp.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) { valid += 1.0; continue; }
    float sd = texture(uDepth, suv).r;
    if (sd >= 0.99999) { valid += 1.0; continue; }
    vec3 Q = worldAt(suv, sd);
    vec3 v = Q - P;
    float vl = length(v);
    if (vl < 1e-4) { valid += 1.0; continue; }
    float vn = dot(v, N) / vl;
    // Only the part of the depth buffer that lies *inside* our sampling
    // hemisphere may occlude. The old smoothstep(0,1,radius/vl) still returned
    // ~0.02 at 9 m distance, so a downward-facing ceiling was "occluded" by the
    // pool floor far below and lost ~60% of its light to low-frequency noise.
    float rangeCheck = clamp(1.0 - (vl - radius) / (radius * 0.75), 0.0, 1.0);
    occ += max(vn - 0.06, 0.0) * rangeCheck;
    valid += 1.0;
  }
  float ao = 1.0 - (occ / max(valid, 1.0)) * 1.85;
  oColor = vec4(clamp(ao, 0.0, 1.0));
}
