#version 300 es
precision highp float;
layout(location=0) in vec2 aP;
out vec2 vUV;
void main(){ vUV = aP*0.5+0.5; gl_Position = vec4(aP,0.0,1.0); }
