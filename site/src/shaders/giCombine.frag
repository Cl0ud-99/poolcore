#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oColor;
uniform sampler2D uLit;
uniform sampler2D uGI;
uniform sampler2D uAlbedo;
uniform sampler2D uAO;
uniform sampler2D uDepth;
uniform float uStrength;
uniform float uDebug;

void main() {
  vec3 lit = texture(uLit, vUV).rgb;
  vec4 gi = texture(uGI, vUV);
  vec4 alb = texture(uAlbedo, vUV);
  float ao = texture(uAO, vUV).r;
  float d = texture(uDepth, vUV).r;
  if (d >= 0.99999) { oColor = vec4(lit, 1.0); return; }
  vec3 bounce = alb.rgb * gi.rgb * uStrength * mix(0.35, 1.0, ao);
  vec3 col = lit + bounce;
  if (uDebug > 0.5) col = bounce;
  oColor = vec4(col, 1.0);
}
