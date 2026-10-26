#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oColor;

uniform sampler2D uTex;
uniform vec2 uTexel;   // 1/w, 1/h of the SOURCE texture
uniform float uScale;  // blur radius multiplier for this iteration

// Wide, soft blur used for the white-diffusion layer.
//
// This is deliberately NOT a bloom: bloom only reacts to pixels above a
// brightness threshold, so it leaves midtones sharp. A white diffusion filter
// sits in front of the lens and softens EVERYTHING, which is why it reads as
// "hazy glass" rather than "glowing highlights".
//
// Kawase-style 5-tap cross, repeated with a growing step. Cheap, and the growing
// radius builds a very wide kernel without the ringing a single big gaussian
// would introduce.
void main() {
  vec2 t = uTexel * uScale;
  vec3 s  = texture(uTex, vUV).rgb * 4.0;
  s += texture(uTex, vUV + vec2(-t.x,  t.y)).rgb;
  s += texture(uTex, vUV + vec2( t.x,  t.y)).rgb;
  s += texture(uTex, vUV + vec2(-t.x, -t.y)).rgb;
  s += texture(uTex, vUV + vec2( t.x, -t.y)).rgb;
  oColor = vec4(s * 0.125, 1.0);
}
