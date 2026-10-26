export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: true, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false,
  });
  if (!gl) throw new Error('WebGL2 not available');
  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_color_buffer_half_float');
  gl.getExtension('OES_texture_float_linear');
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  gl.__aniso = aniso;
  return gl;
}

function shader(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n');
    console.error('[shader ' + name + '] ' + log + '\n' + lines);
    throw new Error('Shader compile failed (' + name + '): ' + log);
  }
  return s;
}

export class Prog {
  constructor(gl, vsSrc, fsSrc, name) {
    this.gl = gl; this.name = name;
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, vsSrc, name + '.vs'));
    gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, fsSrc, name + '.fs'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('Link failed (' + name + '): ' + gl.getProgramInfoLog(p));
    }
    this.p = p;
    this.locs = new Map();
    this.unit = 0;
    this._texNames = [];
  }
  use() { this.gl.useProgram(this.p); this.unit = 0; return this; }
  loc(n) {
    let l = this.locs.get(n);
    if (l === undefined) { l = this.gl.getUniformLocation(this.p, n); this.locs.set(n, l); }
    return l;
  }
  u1f(n, v) { const l = this.loc(n); if (l) this.gl.uniform1f(l, v); return this; }
  u1i(n, v) { const l = this.loc(n); if (l) this.gl.uniform1i(l, v); return this; }
  u2f(n, x, y) { const l = this.loc(n); if (l) this.gl.uniform2f(l, x, y); return this; }
  u3f(n, x, y, z) { const l = this.loc(n); if (l) this.gl.uniform3f(l, x, y, z); return this; }
  u3v(n, a) { const l = this.loc(n); if (l) this.gl.uniform3fv(l, a); return this; }
  u4f(n, x, y, z, w) { const l = this.loc(n); if (l) this.gl.uniform4f(l, x, y, z, w); return this; }
  u4v(n, a) { const l = this.loc(n); if (l) this.gl.uniform4fv(l, a); return this; }
  u1v(n, a) { const l = this.loc(n); if (l) this.gl.uniform1fv(l, a); return this; }
  u1iv(n, a) { const l = this.loc(n); if (l) this.gl.uniform1iv(l, a); return this; }
  m4(n, m) { const l = this.loc(n); if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }
  tex(n, t, target) {
    const gl = this.gl;
    const l = this.loc(n);
    if (l) {
      gl.activeTexture(gl.TEXTURE0 + this.unit);
      gl.bindTexture(target || gl.TEXTURE_2D, t);
      gl.uniform1i(l, this.unit);
      this.unit++;
    }
    return this;
  }
}

export function tex2D(gl, o) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const w = o.w, h = o.h || o.w;
  const lvls = o.mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, lvls, o.internal, w, h);
  if (o.data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, o.format, o.type, o.data);
  const filt = o.filter || gl.LINEAR;
  const wrap = o.wrap || gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mips ? gl.LINEAR_MIPMAP_LINEAR : filt);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  if (o.mips) gl.generateMipmap(gl.TEXTURE_2D);
  if (o.aniso && gl.__aniso) {
    gl.texParameterf(gl.TEXTURE_2D, gl.__aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(o.aniso, 16));
  }
  t.__w = w; t.__h = h;
  return t;
}

export function texCube(gl, o) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
  const size = o.w;
  const lvls = o.mips ? Math.floor(Math.log2(size)) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, lvls, o.internal, size, size);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, o.mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  t.__w = size;
  return t;
}

export class FBO {
  constructor(gl, o) {
    this.gl = gl;
    this.fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    this.color = o.color || [];
    this.depth = o.depth || null;
    this.color.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    if (this.depth) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0);
    }
    const bufs = this.color.map((_, i) => gl.COLOR_ATTACHMENT0 + i);
    if (bufs.length) gl.drawBuffers(bufs);
    if (!this.color.length) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) console.error('FBO incomplete', this.name, st);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.w = o.w; this.h = o.h;
  }
  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, this.w, this.h);
    return this;
  }
}

export function depthTex(gl, w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function makeVAO(gl, attribs, index) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  for (const a of attribs) {
    gl.bindBuffer(gl.ARRAY_BUFFER, a.buf);
    gl.enableVertexAttribArray(a.loc);
    gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, a.stride, a.offset);
  }
  if (index) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
  gl.bindVertexArray(null);
  return vao;
}

export function drawFullscreen(gl) {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

export function fsQuadVAO(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export const FS_VS = `#version 300 es
layout(location=0) in vec2 aP;
out vec2 vUV;
void main(){ vUV = aP*0.5+0.5; gl_Position = vec4(aP,0.0,1.0); }`;
