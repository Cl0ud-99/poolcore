// ============================================================
//  Renderer: deferred G-buffer -> AO -> GI -> lighting -> water -> post
// ============================================================
import { createContext, Prog, tex2D, texCube, FBO, depthTex, fsQuadVAO } from './gl.js';
import { M4, V3 } from './math.js';
import { packMaterials } from './materials.js';
import { WATER_Y, POOL } from './level.js';

const SHADOW_SIZE = 4096;

const CUBE_DIRS = [
  [[1,0,0], [0,-1,0], [0,0,-1]],
  [[-1,0,0], [0,-1,0], [0,0,1]],
  [[0,1,0], [0,0,1], [1,0,0]],
  [[0,-1,0], [0,0,-1], [1,0,0]],
  [[0,0,1], [0,-1,0], [-1,0,0]],
  [[0,0,-1], [0,-1,0], [1,0,0]],
];

function cubeView(eye, f) {
  const d = CUBE_DIRS[f];
  const r = d[0], u = d[1], b = d[2];
  const m = new Float32Array(16);
  m[0] = r[0]; m[4] = r[1]; m[8] = r[2]; m[12] = -V3.dot(r, eye);
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[13] = -V3.dot(u, eye);
  m[2] = -b[0]; m[6] = -b[1]; m[10] = -b[2]; m[14] = V3.dot(b, eye);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  return m;
}

// Halton(2,3) sub-pixel jitter for temporal supersampling
function halton(i, b) {
  let f = 1, r = 0;
  while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
  return r;
}

export class Renderer {
  constructor(canvas) {
    const gl = createContext(canvas);
    this.gl = gl;
    this.canvas = canvas;
    this.quad = fsQuadVAO(gl);
    this.w = 0; this.h = 0;
    this.frame = 0;
    this.time = 0;
    this.exposure = 0.260;
    this.bloomStr = 0.055;
    this.sunDir = V3.norm([-0.17, 0.955, 0.24]);
    this.sunColor = [20.6, 19.4, 16.2];
    this.skyColor = [0.315, 0.290, 0.205];
    this.groundColor = [0.760, 0.700, 0.560];
    this.fogAmount = 0.62;
    this.lights = [];
    this.portals = [];
    this.lightScale = 0.85;
    this.portalScale = 0.45;
    this.mats = packMaterials();
    this.envCube = null;
    this.giStrength = 1.0;
    this.volStrength = 0.85;
    this.jitter = [0, 0];
    this.jitterIndex = 0;
    this.prevVP = null;
    // Supersampling is OFF by default. TAA already resolves sub-pixel detail
    // across frames, so rendering 1.25x larger was paying 56% more fragment work
    // for anti-aliasing that the temporal filter was going to provide anyway.
    // Raise it back with ?ss=1.25 on a fast GPU.
    this.ssaa = 1.0;
    this.dynScale = 1.0;

    const txt = (n) => fetch('./src/shaders/' + n).then(r => r.text());
    this.ready = Promise.all([
      txt('fs.vert'), txt('common.glsl'), txt('surface.vert'), txt('surface.frag'),
      txt('deferred.frag'), txt('ao.frag'), txt('aoBlur.frag'),
      txt('ssgi.frag'), txt('ssgiBlur.frag'), txt('giCombine.frag'), txt('volumetric.frag'),
      txt('water.frag'), txt('bloomPrefilter.frag'), txt('bloomDown.frag'),
      txt('bloomUp.frag'), txt('composite.frag'), txt('softglow.frag'), txt('taa.frag'), txt('present.frag'),
      txt('shadow.vert'), txt('shadow.frag'),
    ]).then(([fsv, common, sv, sf, df, af, abf, gf, gbf, gcf, vf, wf, bpf, bdf, buf, cf, sgf, tf, pf, shv, shf]) => {
      const C = (s) => s.replace(/(#version 300 es\n(?:[ \t]*precision[^\n]*\n)*)/, (m) => m + common + '\n');
      this.pSurface = new Prog(gl, sv, C(sf), 'surface');
      this.pDeferred = new Prog(gl, fsv, C(df), 'deferred');
      this.pAO = new Prog(gl, fsv, C(af), 'ao');
      this.pAOBlur = new Prog(gl, fsv, abf, 'aoBlur');
      this.pSSGI = new Prog(gl, fsv, C(gf), 'ssgi');
      this.pSSGIBlur = new Prog(gl, fsv, C(gbf), 'ssgiBlur');
      this.pGICombine = new Prog(gl, fsv, C(gcf), 'giCombine');
      this.pVol = new Prog(gl, fsv, C(vf), 'volumetric');
      this.pWater = new Prog(gl, fsv, C(wf), 'water');
      this.pBloomPre = new Prog(gl, fsv, bpf, 'bloomPre');
      this.pBloomDown = new Prog(gl, fsv, bdf, 'bloomDown');
      this.pBloomUp = new Prog(gl, fsv, buf, 'bloomUp');
      this.pComposite = new Prog(gl, fsv, C(cf), 'composite');
      this.pSoftGlow = new Prog(gl, fsv, sgf, 'softglow');
      this.pTAA = new Prog(gl, fsv, C(tf), 'taa');
      this.pPresent = new Prog(gl, fsv, pf, 'present');
      this.pShadow = new Prog(gl, shv, shf, 'shadow');
      this.common = common;
      this.envCube = texCube(gl, { w: 256, internal: gl.RGBA16F, mips: true });
      this.buildTargets();
    });
  }

  setSize(w, h) {
    // Remember the requested canvas size; the internal buffer may be larger
    // (supersampling) or smaller (dynamic scale).
    this.canvasW = w; this.canvasH = h;
    if (this.gl && this.pSurface) this.applyRenderSize();
  }

  // ---- dynamic resolution ----
  // The heavy passes (G-buffer, AO, SSGI, volumetric, water, SSR) dominate frame
  // time, and every one of them scales with pixel count. When the camera is
  // moving, a slightly softer image is far less objectionable than a stutter, so
  // the internal buffer drops a step and comes back once the view settles.
  setDynamicScale(s) {
    s = Math.max(0.5, Math.min(1.0, s));
    if (Math.abs(s - (this.dynScale ?? 1.0)) < 0.02) return;
    this.dynScale = s;
    this.applyRenderSize();
  }

  // The internal render size is the canvas size times a supersample factor,
  // times the dynamic scale. Keeping this in one place means a resize and a
  // scale change can never disagree about the buffer dimensions.
  applyRenderSize() {
    // 1.5 rather than 2.0. On a HiDPI panel dpr=2 quadruples the pixel count;
    // 1.5 keeps the image crisp while cutting fragment work by ~44%, and the
    // difference is hard to see through the temporal filter and grain.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const ss = this.ssaa ?? 1.0;
    const dyn = this.dynScale ?? 1.0;
    const baseW = Math.max(2, Math.floor(window.innerWidth * dpr * (this._userScale ?? 1)));
    const baseH = Math.max(2, Math.floor(window.innerHeight * dpr * (this._userScale ?? 1)));
    const w = Math.max(2, Math.floor(baseW * ss * dyn));
    const h = Math.max(2, Math.floor(baseH * ss * dyn));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.buildTargets();
  }

  buildTargets() {
    const gl = this.gl, w = this.w, h = this.h;
    if (!w || !h) return;
    const del = (t) => { if (t) gl.deleteTexture(t); };
    const delF = (f) => { if (f) gl.deleteFramebuffer(f.fb); };
    if (this.gbuf) {
      this.gbuf.color.forEach(del); del(this.gbuf.depth); delF(this.gbuf);
      del(this.aoTex); delF(this.aoFBO); del(this.aoTex2); delF(this.aoFBO2);
      del(this.litTex); delF(this.litFBO); del(this.waterTex); delF(this.waterFBO);
      del(this.giTex); delF(this.giFBO); del(this.giTex2); delF(this.giFBO2);
      del(this.bounceTex); delF(this.bounceFBO);
      del(this.volTex); delF(this.volFBO);
      this.bloom.forEach(b => { del(b.tex); delF(b.fbo); });
      del(this.taaTex[0]); del(this.taaTex[1]); delF(this.taaFBO[0]); delF(this.taaFBO[1]);
      del(this.prevDepthTex);
      if (this.softTex) { del(this.softTex[0]); del(this.softTex[1]); delF(this.softFBO[0]); delF(this.softFBO[1]); }
      if (this.compTex) { del(this.compTex); delF(this.compFBO); }
    }
    const F = gl.RGBA8, HF = gl.RGBA16F;
    const t = (o) => tex2D(gl, o);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);

    this.gbuf = new FBO(gl, {
      w, h,
      color: [
        t({ w, h, internal: F, format: gl.RGBA, type: gl.UNSIGNED_BYTE }),
        t({ w, h, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT }),
        t({ w, h, internal: F, format: gl.RGBA, type: gl.UNSIGNED_BYTE }),
        t({ w, h, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT }),
      ],
      depth: depthTex(gl, w, h),
    });
    this.depth = this.gbuf.depth;

    this.aoTex = t({ w, h, internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE });
    this.aoFBO = new FBO(gl, { w, h, color: [this.aoTex] });
    this.aoTex2 = t({ w, h, internal: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE });
    this.aoFBO2 = new FBO(gl, { w, h, color: [this.aoTex2] });

    this.litTex = t({ w, h, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT });
    this.litFBO = new FBO(gl, { w, h, color: [this.litTex] });

    this.giTex = t({ w: hw, h: hh, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR });
    this.giFBO = new FBO(gl, { w: hw, h: hh, color: [this.giTex] });
    this.giTex2 = t({ w: hw, h: hh, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR });
    this.giFBO2 = new FBO(gl, { w: hw, h: hh, color: [this.giTex2] });

    this.volTex = t({ w: hw, h: hh, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR });
    this.volFBO = new FBO(gl, { w: hw, h: hh, color: [this.volTex] });

    this.bounceTex = t({ w, h, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT });
    this.bounceFBO = new FBO(gl, { w, h, color: [this.bounceTex] });

    this.waterTex = t({ w, h, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT });
    this.waterFBO = new FBO(gl, { w, h, color: [this.waterTex] });

    this.bloom = [];
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    for (let i = 0; i < 6; i++) {
      const tex = t({ w: bw, h: bh, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT });
      this.bloom.push({ tex, fbo: new FBO(gl, { w: bw, h: bh, color: [tex] }), w: bw, h: bh });
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }

    // White-diffusion chain: two half-res ping-pong buffers. Half resolution is
    // plenty because the result is blurred far past the point where detail
    // survives, and it keeps the pass nearly free.
    this.softW = hw; this.softH = hh;
    this.softTex = [
      t({ w: hw, h: hh, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR }),
      t({ w: hw, h: hh, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR }),
    ];
    this.softFBO = [
      new FBO(gl, { w: hw, h: hh, color: [this.softTex[0]] }),
      new FBO(gl, { w: hw, h: hh, color: [this.softTex[1]] }),
    ];

    this.taaTex = [
      t({ w, h, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT }),
      t({ w, h, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT }),
    ];
    // Composite writes here; TAA resolves from here into the history pair. A
    // separate texture is required: TAA cannot read and write the same target,
    // and with only two ping-pong buffers both slots are occupied (one as cur,
    // one as prev) leaving nowhere to write.
    this.compTex = t({ w, h, internal: HF, format: gl.RGBA, type: gl.HALF_FLOAT });
    this.compFBO = new FBO(gl, { w, h, color: [this.compTex] });

    // TAA needs the depth of the PREVIOUS frame to validate its reprojection.
    // Binding the current depth to uPrevDepth makes the check compare a value
    // with itself, so dz is always zero and the validation always passes - which
    // is exactly how a moving camera ends up smearing the old frame across the
    // new one as bright ghosts.
    this.prevDepthTex = depthTex(gl, w, h);
    this.prevDepthFBO = new FBO(gl, { w, h, color: [], depth: this.prevDepthTex });
    this.taaFBO = [new FBO(gl, { w, h, color: [this.taaTex[0]] }), new FBO(gl, { w, h, color: [this.taaTex[1]] })];
    this.taaIdx = 0;
    this._aoFrame = 0;
    this._giFrame = 0;

    if (!this.shadowTex) {
      this.shadowTex = depthTex(gl, SHADOW_SIZE, SHADOW_SIZE);
      this.shadowFBO = new FBO(gl, { w: SHADOW_SIZE, h: SHADOW_SIZE, color: [], depth: this.shadowTex });
    }
  }

  setGeometry(meshGPU) { this.mesh = meshGPU; this._shadowBaked = false; }

  computeShadowVP() {
    const sunDir = this.sunDir;
    const center = [0, 1.0, 0];
    const eye = V3.add(center, V3.mul(sunDir, 78));
    const view = M4.lookAt(M4.create(), eye, center, Math.abs(sunDir[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]);
    const proj = M4.ortho(M4.create(), -40, 40, -40, 40, 1, 170);
    this.shadowVP = M4.mul(M4.create(), proj, view);
    return this.shadowVP;
  }

  renderShadow() {
    // The level geometry never moves, so the shadow map is identical every
    // frame. Re-rendering 127k triangles into a 4096x4096 depth target each
    // frame was pure waste - it is now baked once and reused until the sun
    // direction actually changes.
    const key = this.sunDir.join(',');
    if (this._shadowKey === key && this._shadowBaked) return;
    this._shadowKey = key;
    this._shadowBaked = true;

    const gl = this.gl;
    const vp = this.computeShadowVP();
    this.shadowFBO.bind();
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    const p = this.pShadow.use();
    p.m4('uVP', vp);
    gl.bindVertexArray(this.mesh.vao);
    gl.drawElements(gl.TRIANGLES, this.mesh.count, this.mesh.type, 0);
    gl.cullFace(gl.BACK);
  }

  gbufferPass(vp, camPos) {
    const gl = this.gl, w = this.w, h = this.h;
    this.gbuf.bind();
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3]);
    gl.clearColor(0, 0, 0, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    // LESS, not LEQUAL. With LEQUAL a coplanar face drawn later overwrites the
    // earlier one, and because the two depth values are numerically almost
    // identical the winner flips from frame to frame - the flickering seams.
    gl.depthFunc(gl.LESS);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    // Pull every surface very slightly toward the camera. The units are
    // implementation-defined depth steps, so this is a small constant: enough to
    // break ties between coincident planes, far too small to affect ordering of
    // real geometry.
    gl.polygonOffset(-1.0, -2.0);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    const ps = this.pSurface.use();
    ps.m4('uVP', vp);
    ps.u3f('uCamPos', camPos[0], camPos[1], camPos[2]);
    ps.u1f('uTime', this.time);
    ps.u1f('uWaterY', WATER_Y);
    ps.u4v('uMatA', this.mats.A); ps.u4v('uMatB', this.mats.B);
    ps.u4v('uMatC', this.mats.C); ps.u4v('uMatD', this.mats.D);
    gl.bindVertexArray(this.mesh.vao);
    gl.drawElements(gl.TRIANGLES, this.mesh.count, this.mesh.type, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  aoPass(vp, invVP, camPos) {
    const gl = this.gl, w = this.w, h = this.h;
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quad);
    this.aoFBO.bind();
    let p = this.pAO.use();
    p.tex('uDepth', this.depth).tex('uNormal', this.gbuf.color[1]);
    p.m4('uVP', vp); p.m4('uInvVP', invVP);
    p.u3f('uCamPos', camPos[0], camPos[1], camPos[2]);
    p.u2f('uRes', w, h); p.u1f('uRadius', this.aoRadius ?? 0.75);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.aoFBO2.bind();
    p = this.pAOBlur.use();
    p.tex('uAO', this.aoTex).tex('uDepth', this.depth);
    p.u2f('uTexel', 1 / w, 1 / h); p.u2f('uDir', 1, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.aoFBO.bind();
    p = this.pAOBlur.use();
    p.tex('uAO', this.aoTex2).tex('uDepth', this.depth);
    p.u2f('uTexel', 1 / w, 1 / h); p.u2f('uDir', 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  deferredPass(vp, invVP, camPos, envTex, ssrOn, envInt) {
    const gl = this.gl, w = this.w, h = this.h;
    this.litFBO.bind();
    const p = this.pDeferred.use();
    p.tex('uAlbedo', this.gbuf.color[0]).tex('uNormal', this.gbuf.color[1])
     .tex('uMR', this.gbuf.color[2]).tex('uEmit', this.gbuf.color[3])
     .tex('uDepth', this.depth).tex('uAO', this.aoTex).tex('uShadowMap', this.shadowTex)
     .tex('uPrevLit', this.bounceTex)
     .tex('uEnv', envTex, gl.TEXTURE_CUBE_MAP);
    p.m4('uShadowVP', this.shadowVP); p.m4('uVP', vp); p.m4('uInvVP', invVP);
    p.u3f('uCamPos', camPos[0], camPos[1], camPos[2]);
    p.u3f('uSunDir', this.sunDir[0], this.sunDir[1], this.sunDir[2]);
    p.u3f('uSunColor', this.sunColor[0], this.sunColor[1], this.sunColor[2]);
    p.u3f('uSkyColor', this.skyColor[0], this.skyColor[1], this.skyColor[2]);
    p.u3f('uGroundColor', this.groundColor[0], this.groundColor[1], this.groundColor[2]);
    p.u1f('uEnvIntensity', envInt);
    p.u1f('uEnvMips', 9.0);
    p.u1f('uShadowOn', this.shadowOn ?? 1.0);
    p.u1f('uSSROn', ssrOn);
    p.u2f('uRes', w, h); p.u1f('uTime', this.time);
    p.u1f('uFog', this.fogAmount ?? 0.55);
    p.u1f('uDebug', this.debugView ?? 0.0);
    const lights = this.lights || [];
    p.u1i('uLightCount', Math.min(lights.length, 64));
    for (let i = 0; i < lights.length && i < 64; i++) {
      const L = lights[i];
      p.u4f('uLightPos[' + i + ']', L.pos[0], L.pos[1], L.pos[2], L.radius);
      p.u4f('uLightCol[' + i + ']', L.color[0], L.color[1], L.color[2], L.intensity * this.lightScale);
    }
    const portals = this.portals || [];
    p.u1i('uPortalCount', Math.min(portals.length, 10));
    for (let i = 0; i < portals.length && i < 10; i++) {
      const Q = portals[i];
      p.u4f('uPortalPos[' + i + ']', Q.pos[0], Q.pos[1], Q.pos[2], Q.radius);
      p.u4f('uPortalCol[' + i + ']', Q.color[0], Q.color[1], Q.color[2], Q.intensity * this.portalScale);
      p.u4f('uPortalNrm[' + i + ']', Q.nrm[0], Q.nrm[1], Q.nrm[2], 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  ssgiPass(vp, invVP, camPos, scale) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quad);
    this.giFBO.bind();
    let p = this.pSSGI.use();
    p.tex('uDepth', this.depth).tex('uNormal', this.gbuf.color[1]).tex('uLit', this.litTex);
    p.m4('uVP', vp); p.m4('uInvVP', invVP);
    p.u3f('uCamPos', camPos[0], camPos[1], camPos[2]);
    p.u2f('uRes', this.w, this.h);
    p.u1f('uFrame', this.frame);
    // 7 m was shorter than the vault-to-floor distance (11.7 m), so a soffit
    // facing down could never see the floor it is actually lit by. Every ray
    // either escaped or hit a nearby beam, and the old hit-normalised gather
    // amplified those rare hits into brown blotches. Reach the floor instead.
    p.u1f('uMaxDist', this.ssgiMaxDist ?? 18.0);
    p.u1f('uStrength', 1.0);
    p.u1f('uThick', 0.9);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const hw = this.giFBO.w, hh = this.giFBO.h;
    this.giFBO2.bind();
    p = this.pSSGIBlur.use();
    p.tex('uGI', this.giTex).tex('uDepth', this.depth).tex('uNormal', this.gbuf.color[1]);
    p.u2f('uTexel', 1 / hw, 1 / hh); p.u2f('uDir', 1, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.giFBO.bind();
    p = this.pSSGIBlur.use();
    p.tex('uGI', this.giTex2).tex('uDepth', this.depth).tex('uNormal', this.gbuf.color[1]);
    p.u2f('uTexel', 1 / hw, 1 / hh); p.u2f('uDir', 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  copyLitToBounce() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.litFBO.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.bounceFBO.fb);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  giCombinePass() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quad);
    this.bounceFBO.bind();
    const p = this.pGICombine.use();
    p.tex('uLit', this.litTex).tex('uGI', this.giTex).tex('uAlbedo', this.gbuf.color[0])
     .tex('uAO', this.aoTex).tex('uDepth', this.depth);
    p.u1f('uStrength', this.giStrength);
    p.u1f('uDebug', 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  volPass(vp, invVP, camPos) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quad);
    this.volFBO.bind();
    const p = this.pVol.use();
    p.tex('uDepth', this.depth).tex('uShadowMap', this.shadowTex);
    p.m4('uShadowVP', this.shadowVP); p.m4('uInvVP', invVP);
    p.u3f('uCamPos', camPos[0], camPos[1], camPos[2]);
    p.u3f('uSunDir', this.sunDir[0], this.sunDir[1], this.sunDir[2]);
    p.u3f('uSunColor', this.sunColor[0], this.sunColor[1], this.sunColor[2]);
    p.u2f('uRes', this.w, this.h);
    p.u1f('uFrame', this.frame);
    p.u1f('uDensity', this.volDensity ?? 0.105);
    p.u1f('uMaxDist', this.volMaxDist ?? 46.0);
    p.u1f('uAniso', this.volAniso ?? 0.62);
    p.u1f('uScatter', this.volScatter ?? 1.0);
    p.u1f('uHazeY', this.volHazeY ?? 0.30);
    p.u1f('uVolMode', this.volDebug ?? 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---- baked environment probe: render the room into a cube, twice ----
  bakeEnv(size) {
    size = size || 256;
    const gl = this.gl;
    const realW = this.w, realH = this.h;
    if (!this.envCube || this.envCube.__w !== size) {
      if (this.envCube) gl.deleteTexture(this.envCube);
      this.envCube = texCube(gl, { w: size, internal: gl.RGBA16F, mips: true });
    }
    this.w = size; this.h = size;
    this.buildTargets();
    gl.bindVertexArray(this.quad);
    gl.disable(gl.BLEND);
    this.computeShadowVP();
    const eye = [0, 2.4, 0];
    const proj = M4.perspective(M4.create(), Math.PI / 2, 1, 0.08, 220);
    const emptyCube = texCube(gl, { w: 1, internal: gl.RGBA16F });
    for (let pass = 0; pass < 3; pass++) {
      const envIn = pass === 0 ? emptyCube : this.envCube;
      for (let f = 0; f < 6; f++) {
        const view = cubeView(eye, f);
        const vp = M4.mul(M4.create(), proj, view);
        const invVP = M4.invert(M4.create(), vp);
        this.gbufferPass(vp, eye);
        gl.disable(gl.DEPTH_TEST);
        gl.bindVertexArray(this.quad);
        this.aoPass(vp, invVP, eye);
        this.deferredPass(vp, invVP, eye, envIn, 0.0, pass === 0 ? 0.0 : 1.0);
        if (pass > 0) {
          this.ssgiPass(vp, invVP, eye);
          this.giCombinePass();
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, (pass > 0 ? this.bounceFBO : this.litFBO).fb);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.envCube);
        gl.copyTexSubImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, 0, 0, 0, 0, size, size);
      }
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, this.envCube);
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.deleteTexture(emptyCube);
    this.w = realW; this.h = realH;
    this.buildTargets();
  }

  // Build the white-diffusion layer: a very wide, very soft copy of the finished
  // HDR frame. Five growing-radius taps approximate a diffusion filter at a
  // fraction of a gaussian's cost.
  softGlowPass(srcTex) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.quad);
    gl.disable(gl.BLEND);

    let src = srcTex;
    let dst = 0;
    const STEPS = [1.0, 2.0, 3.5, 6.0, 10.0];
    for (let i = 0; i < STEPS.length; i++) {
      this.softFBO[dst].bind();
      const p = this.pSoftGlow.use();
      p.tex('uTex', src);
      p.u2f('uTexel', 1 / this.softW, 1 / this.softH);
      p.u1f('uScale', STEPS[i]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = this.softTex[dst];
      dst = 1 - dst;
    }
    return src;
  }

  render(cam) {
    const gl = this.gl, w = this.w, h = this.h;
    this.frame++;
    const proj = M4.perspective(M4.create(), cam.fov * Math.PI / 180, w / h, 0.035, 220);
    // Sub-pixel jitter for TAA (Halton 2,3).
    //
    // Two projection matrices are needed. The JITTERED one rasterises the frame;
    // the CLEAN one is used for reprojection. If the jitter is baked into the
    // matrix used to unproject and reproject, the history lookup lands off by the
    // difference between two jitter samples - up to a whole pixel. The 3x3
    // neighbourhood clamp then rejects the history on every edge pixel, which
    // disables temporal accumulation precisely where anti-aliasing is needed and
    // leaves the stair-stepping fully intact.
    const ji = (this.frame % 16) + 1;
    const jx = halton(ji, 2) - 0.5, jy = halton(ji, 3) - 0.5;
    this.jitter = [jx, jy];
    const view = M4.lookAt(M4.create(), cam.pos, cam.target, [0, 1, 0]);
    // clean matrices: no jitter
    const vpClean = M4.mul(M4.create(), proj, view);
    const invVPClean = M4.invert(M4.create(), vpClean);
    // jittered matrices: for rasterisation only
    const projJ = proj.slice();
    projJ[8] += 2.0 * jx / w;
    projJ[9] += 2.0 * jy / h;
    const vp = M4.mul(M4.create(), projJ, view);
    const invVP = M4.invert(M4.create(), vp);

    this.renderShadow();
    this.gbufferPass(vp, cam.pos);
    // AO is likewise blurred before use, so it tolerates a 2-frame refresh. It
    // is forced on the first frame and after any resize (when the targets are
    // fresh) so it never samples an uninitialised texture.
    this._aoFrame = (this._aoFrame || 0) + 1;
    if (this._aoFrame === 1 || (this._aoFrame & 1) === 0) this.aoPass(vp, invVP, cam.pos);
    this.deferredPass(vp, invVP, cam.pos, this.envCube, this.ssrOn ?? 1.0, this.envIntensity ?? 1.0);
    // SSGI is a low-frequency signal that is blurred twice before it is used, so
    // recomputing it every single frame buys almost nothing visually. Alternating
    // it halves one of the two most expensive passes; the previous result stays
    // bound in giTex, so the shading is continuous.
    if (this.giOn ?? 1.0) {
      this._giFrame = (this._giFrame || 0) + 1;
      if ((this._giFrame & 1) === 1) this.ssgiPass(vp, invVP, cam.pos);
      // The combine is a pure texture mix with no state of its own, so it only
      // needs to re-run when its SSGI input changes - which is every other frame.
      // It still writes bounceTex that the water pass reads, so it cannot simply
      // be dropped; skipping it on the off frames halves its cost and leaves the
      // previous result in place, which is at most one frame stale.
      if ((this._giFrame & 1) === 1 || this._giFrame <= 2) this.giCombinePass();
    }
    else this.copyLitToBounce();
    if (this.volOn ?? 1.0) this.volPass(vp, invVP, cam.pos);

    let p;
    this.waterFBO.bind();
    p = this.pWater.use();
    p.tex('uOpaque', this.bounceTex).tex('uDepth', this.depth)
     .tex('uEnv', this.envCube, gl.TEXTURE_CUBE_MAP)
     .tex('uShadowMap', this.shadowTex);
    p.m4('uShadowVP', this.shadowVP); p.m4('uVP', vp); p.m4('uInvVP', invVP);
    p.u3f('uCamPos', cam.pos[0], cam.pos[1], cam.pos[2]);
    p.u3f('uSunDir', this.sunDir[0], this.sunDir[1], this.sunDir[2]);
    p.u3f('uSunColor', this.sunColor[0], this.sunColor[1], this.sunColor[2]);
    p.u2f('uRes', w, h); p.u1f('uTime', this.time);
    p.u1f('uWaterY', WATER_Y);
    p.u1f('uEnvMips', 9.0);
    p.u3f('uWaterDeep', 0.029, 0.048, 0.042);
    p.u3f('uWaterShallow', 0.107, 0.142, 0.107);
    p.u3f('uPoolMin', POOL.x0, 0, POOL.z0);
    p.u3f('uPoolMax', POOL.x1, 0, POOL.z1);
    p.u1f('uSSROn', this.ssrOn ?? 1.0);
    p.u1f('uCaustics', this.waterCaustics ?? 1.0);
    const wl = this.lights || [];
    p.u1i('uLightCount', Math.min(wl.length, 64));
    for (let i = 0; i < wl.length && i < 64; i++) {
      const L = wl[i];
      p.u4f('uLightPos[' + i + ']', L.pos[0], L.pos[1], L.pos[2], L.radius);
      p.u4f('uLightCol[' + i + ']', L.color[0], L.color[1], L.color[2], L.intensity * this.lightScale);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    let src = this.waterTex, sw = w, sh = h;
    this.bloom[0].fbo.bind();
    p = this.pBloomPre.use();
    p.tex('uTex', src).u2f('uTexel', 1 / sw, 1 / sh).u1f('uThreshold', 1.55).u1f('uKnee', 0.45);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    for (let i = 1; i < this.bloom.length; i++) {
      const s = this.bloom[i - 1], d = this.bloom[i];
      d.fbo.bind();
      p = this.pBloomDown.use();
      p.tex('uTex', s.tex).u2f('uTexel', 1 / s.w, 1 / s.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.bloom.length - 2; i >= 0; i--) {
      const s = this.bloom[i + 1], d = this.bloom[i];
      d.fbo.bind();
      p = this.pBloomUp.use();
      p.tex('uTex', s.tex).u2f('uTexel', 1 / s.w, 1 / s.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // Build the diffusion layer from the finished HDR frame, so it contains the
    // water and the god rays as well as the geometry.
    const softTex = this.softGlowPass(this.waterTex);

    const dst = this.taaIdx;
    this.compFBO.bind();
    p = this.pComposite.use();
    p.tex('uHDR', this.waterTex).tex('uBloom', this.bloom[0].tex).tex('uDepth', this.depth)
     .tex('uVol', this.volTex).tex('uSoft', softTex);
    p.u1f('uSoftAmt', this.softAmt ?? 0.22);
    p.u2f('uRes', w, h).u1f('uTime', this.time);
    p.u1f('uExposure', this.exposure);
    p.u1f('uBloomStr', this.bloomStr);
    p.u1f('uGrain', this.grain ?? 0.010).u1f('uVignette', 0.22).u1f('uCA', 0.0012);
    p.u1f('uFrame', this.frame);
    p.u1f('uVolStr', this.volStrength);
    p.u1f('uFocus', this.focusDist ?? 8.0);
    p.u1f('uAperture', this.aperture ?? 0.55);
    p.u1f('uDOF', this.dofOn ?? 1.0);
    p.u3f('uCamPos', cam.pos[0], cam.pos[1], cam.pos[2]);
    p.m4('uInvVP', invVP);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Snapshot this frame's depth for next frame's reprojection test.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.gbuf.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.prevDepthFBO.fb);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // ---- motion-adaptive history weight ----
    // A still view wants a long history (noise suppression); a fast pan wants
    // almost none (no ghosting). Measured from view-direction change plus camera
    // displacement since the previous frame.
    let blend;
    {
      const prev = this._prevCam;
      let motion = 0.0;
      if (prev) {
        const dx = cam.pos[0] - prev.pos[0];
        const dy = cam.pos[1] - prev.pos[1];
        const dz = cam.pos[2] - prev.pos[2];
        const move = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const fx = cam.target[0] - cam.pos[0], fy = cam.target[1] - cam.pos[1], fz = cam.target[2] - cam.pos[2];
        const fl = Math.hypot(fx, fy, fz) || 1;
        const dot = (fx / fl) * prev.dir[0] + (fy / fl) * prev.dir[1] + (fz / fl) * prev.dir[2];
        const turn = Math.acos(Math.max(-1, Math.min(1, dot)));
        motion = Math.min(1, move * 6 + turn * 2.2);
      }
      this._prevCam = {
        pos: cam.pos.slice(),
        dir: (() => {
          const fx = cam.target[0] - cam.pos[0], fy = cam.target[1] - cam.pos[1], fz = cam.target[2] - cam.pos[2];
          const l = Math.hypot(fx, fy, fz) || 1;
          return [fx / l, fy / l, fz / l];
        })(),
      };
      const base = this.taaBlend ?? 0.90;
      blend = base - (base - 0.55) * motion;
      this._taaMotion = motion;
    }

    // ---- TAA resolve ----
    // The result must go somewhere that the NEXT frame can read as history.
    // Drawing only to the default framebuffer (the old behaviour) meant uPrev
    // always pointed at raw, un-resolved composite output: the history chain was
    // broken, every frame blended against a non-history buffer, and the error
    // re-accumulated and reset each frame. That is the flickering white fringe
    // that trails the geometry while panning.
    //
    // Resolve into taaTex[dst], then blit that to the screen.
    // Resolve: cur = compTex (this frame), prev = taaTex[1-dst] (last frame's
    // resolved output), destination = taaTex[dst] (the slot holding the OLDER
    // history, now free to overwrite). No texture is read and written at once.
    const resIdx = dst;
    this.taaFBO[resIdx].bind();
    gl.viewport(0, 0, w, h);
    p = this.pTAA.use();
    p.tex('uCur', this.compTex).tex('uPrev', this.taaTex[1 - dst]).tex('uDepth', this.depth)
     .tex('uPrevDepth', this.prevDepthTex);
    // Reprojection uses the CLEAN matrices (see the jitter note above): the
    // history must be sampled at the position this pixel would have occupied
    // without dithering, otherwise the clamp rejects it on every edge.
    p.m4('uInvVP', invVPClean);
    p.m4('uPrevVP', this.prevVPClean || vpClean);
    p.u2f('uRes', w, h).u1f('uBlend', blend).u1f('uFirst', this.frame <= 2 ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Present the resolved frame.
    //
    // When the render buffer matches the canvas exactly there is nothing to
    // resample, so a plain blit is both correct and much cheaper than running a
    // full-screen shader. The filtered path only matters when supersampling (or
    // dynamic resolution) makes the buffers differ in size.
    const sameSize = (w === this.canvas.width && h === this.canvas.height);
    if (sameSize) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.taaFBO[resIdx].fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, this.canvas.width, this.canvas.height,
                         gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this.quad);
      p = this.pPresent.use();
      p.tex('uTex', this.taaTex[resIdx]);
      p.u2f('uRes', this.canvas.width, this.canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Advance the ping-pong. The slot we just wrote holds this frame's resolved
    // result; next frame it must be read as uPrev, so taaIdx has to move to the
    // OTHER slot. Leaving taaIdx unchanged made prev and write point at the same
    // buffer forever, so history never advanced and the resolve blended against
    // stale data - the flickering fringe.
    this.taaIdx = 1 - dst;
    this.prevVP = vp;
    this.prevVPClean = vpClean;
    this.prevDepthReady = true;
  }
}
