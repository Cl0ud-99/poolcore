#version 300 es
precision highp float;
in vec3 aPos;
in vec3 aNrm;
in vec2 aUV;
in vec2 aAO;
uniform mat4 uVP;
out vec3 vPos;
out vec3 vNrm;
out vec2 vUV;
out vec2 vAO;
void main() {
  vPos = aPos; vNrm = aNrm; vUV = aUV; vAO = aAO;
  gl_Position = uVP * vec4(aPos, 1.0);
}
