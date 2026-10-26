#version 300 es
precision highp float;
in float vMat;
out vec4 oCol;
void main() {
  int m = int(vMat + 0.5);
  // 20 = SKY portal (window pane / skylight): light must pass through it
  if (m == 20) discard;
  oCol = vec4(1.0);
}
