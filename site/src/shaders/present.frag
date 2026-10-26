#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oColor;
uniform sampler2D uTex;
uniform vec2 uRes;

// Final present. When the render buffer is larger than the canvas this performs
// a 4-tap rotated-grid downsample, which is a slightly better box filter than a
// single bilinear tap (it covers the full footprint instead of 2x2 texels) and is
// what removes the remaining stair-stepping on near-horizontal edges.
void main() {
  vec2 t = 1.0 / vec2(textureSize(uTex, 0));
  vec3 c = texture(uTex, vUV).rgb * 0.25;
  c += texture(uTex, vUV + vec2( t.x,  t.y) * 0.5).rgb * 0.25;
  c += texture(uTex, vUV + vec2(-t.x,  t.y) * 0.5).rgb * 0.25;
  c += texture(uTex, vUV + vec2( t.x, -t.y) * 0.5).rgb * 0.25;
  oColor = vec4(c, 1.0);
}
