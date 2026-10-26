#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oColor;
uniform sampler2D uTex;
uniform vec2 uTexel;
void main() {
  vec3 s = vec3(0.0);
  s += texture(uTex, vUV + uTexel * vec2(-1.0, -1.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2( 1.0, -1.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2(-1.0,  1.0)).rgb;
  s += texture(uTex, vUV + uTexel * vec2( 1.0,  1.0)).rgb;
  oColor = vec4(s * 0.25, 1.0);
}
