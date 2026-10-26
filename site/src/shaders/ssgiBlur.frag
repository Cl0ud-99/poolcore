#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oColor;
uniform sampler2D uGI;
uniform sampler2D uDepth;
uniform sampler2D uNormal;
uniform vec2 uTexel;
uniform vec2 uDir;

vec3 octDecode2(vec2 e) {
  vec3 n = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}

void main() {
  vec4 c0 = texture(uGI, vUV);
  float d0 = texture(uDepth, vUV).r;
  vec3 n0 = octDecode2(texture(uNormal, vUV).xy * 2.0 - 1.0);
  vec3 acc = c0.rgb; float wsum = 1.0;
  for (int i = 1; i <= 4; i++) {
    float fi = float(i);
    for (int s = -1; s <= 1; s += 2) {
      vec2 uv = vUV + uDir * uTexel * fi * float(s);
      vec4 c = texture(uGI, uv);
      float d = texture(uDepth, uv).r;
      vec3 n = octDecode2(texture(uNormal, uv).xy * 2.0 - 1.0);
      float wd = exp(-abs(d - d0) * 420.0);
      float wn = max(0.0, dot(n, n0));
      float w = wd * wn * wn * exp(-fi * 0.22);
      acc += c.rgb * w; wsum += w;
    }
  }
  oColor = vec4(acc / max(wsum, 1e-4), c0.a);
}
