#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oColor;
uniform sampler2D uAO;
uniform sampler2D uDepth;
uniform vec2 uTexel;
uniform vec2 uDir;
void main() {
  float d = texture(uDepth, vUV).r;
  float sum = 0.0, wsum = 0.0;
  for (int i = -5; i <= 5; i++) {
    vec2 uv = vUV + uDir * uTexel * float(i);
    float dd = texture(uDepth, uv).r;
    float w = exp(-abs(float(i)) * 0.5) * (1.0 - smoothstep(0.0008, 0.006, abs(dd - d)));
    sum += texture(uAO, uv).r * w;
    wsum += w;
  }
  oColor = vec4(sum / max(wsum, 1e-4));
}
