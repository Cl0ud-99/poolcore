#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aNrm;
in vec2 aUV;
in vec2 aAO;
uniform mat4 uVP;
out float vMat;
void main() {
  vMat = aAO.y;
  gl_Position = uVP * vec4(aPos, 1.0);
}
