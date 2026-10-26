#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
vec3 pre(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  return c * contrib;
}
void main() {
  vec3 s = vec3(0.0);
  s += pre(texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb);
  s += pre(texture(uTex, vUV + uTexel * vec2( 1.0, -1.0)).rgb);
  s += pre(texture(uTex, vUV + uTexel * vec2(-1.0,  1.0)).rgb);
  s += pre(texture(uTex, vUV + uTexel * vec2( 1.0,  1.0)).rgb);
  s += pre(texture(uTex, vUV).rgb) * 2.0;
  oColor = vec4(s / 6.0, 1.0);
}
