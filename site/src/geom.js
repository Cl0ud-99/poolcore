// ============================================================
//  Geometry builder: positions, normals, uv (metres), ao+material
// ============================================================
import { V3 } from './math.js';

export class Mesh {
  constructor() {
    this.pos = []; this.nrm = []; this.uv = []; this.ao = []; this.idx = [];
  }
  get vcount() { return this.pos.length / 3; }
  vert(p, n, uv, ao, mi) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(uv[0], uv[1]);
    this.ao.push(ao, mi);
    return this.vcount - 1;
  }
  // quad with explicit corner order a->b->c->d (ccw when viewed from front)
  quad(a, b, c, d, n, uvScale, mi, ao) {
    const s = uvScale || 1;
    const nn = V3.norm(n);
    // build tangent basis from edge
    const e1 = V3.norm(V3.sub(b, a));
    const e2 = V3.cross(nn, e1);
    const uvOf = (p) => {
      const r = V3.sub(p, a);
      return [V3.dot(r, e1) * s, V3.dot(r, e2) * s];
    };
    const i0 = this.vert(a, nn, uvOf(a), ao === undefined ? 1 : ao, mi);
    this.vert(b, nn, uvOf(b), ao === undefined ? 1 : ao, mi);
    this.vert(c, nn, uvOf(c), ao === undefined ? 1 : ao, mi);
    this.vert(d, nn, uvOf(d), ao === undefined ? 1 : ao, mi);
    // enforce winding so the face is front-facing for the supplied normal
    const cn = V3.cross(V3.sub(b, a), V3.sub(c, a));
    if (V3.dot(cn, nn) >= 0) this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    else this.idx.push(i0, i0 + 2, i0 + 1, i0, i0 + 3, i0 + 2);
    return this;
  }
  tri(a, b, c, n, uvScale, mi, ao) {
    const s = uvScale || 1;
    const nn = V3.norm(n);
    const e1 = V3.norm(V3.sub(b, a));
    const e2 = V3.cross(nn, e1);
    const uvOf = (p) => { const r = V3.sub(p, a); return [V3.dot(r, e1) * s, V3.dot(r, e2) * s]; };
    const i0 = this.vert(a, nn, uvOf(a), ao === undefined ? 1 : ao, mi);
    this.vert(b, nn, uvOf(b), ao === undefined ? 1 : ao, mi);
    this.vert(c, nn, uvOf(c), ao === undefined ? 1 : ao, mi);
    const cn = V3.cross(V3.sub(b, a), V3.sub(c, a));
    if (V3.dot(cn, nn) >= 0) this.idx.push(i0, i0 + 1, i0 + 2);
    else this.idx.push(i0, i0 + 2, i0 + 1);
    return this;
  }
  // axis aligned box from min to max
  box(min, max, mi, uvScale, opts) {
    opts = opts || {};
    const s = uvScale || 1;
    const [x0, y0, z0] = min, [x1, y1, z1] = max;
    const skip = opts.skip || '';
    if (!skip.includes('-y')) this.quad([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [0, -1, 0], s, mi);
    if (!skip.includes('+y')) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], s, mi);
    if (!skip.includes('-z')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], s, mi);
    if (!skip.includes('+z')) this.quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1], s, mi);
    if (!skip.includes('-x')) this.quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0], s, mi);
    if (!skip.includes('+x')) this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], s, mi);
    return this;
  }
  // open cylinder / tube segment along a path of points
  tube(path, radius, mi, seg, uvScale, capEnds) {
    seg = seg || 12;
    const s = uvScale || 1;
    const n = path.length;
    // frames
    const frames = [];
    let prevN = null;
    for (let i = 0; i < n; i++) {
      let t;
      if (i === 0) t = V3.sub(path[1], path[0]);
      else if (i === n - 1) t = V3.sub(path[n - 1], path[n - 2]);
      else t = V3.sub(path[i + 1], path[i - 1]);
      t = V3.norm(t);
      let up = [0, 1, 0];
      if (Math.abs(V3.dot(t, up)) > 0.95) up = [1, 0, 0];
      let nn = V3.norm(V3.cross(up, t));
      if (prevN) {
        // parallel transport
        nn = V3.norm(V3.sub(nn, V3.mul(t, V3.dot(nn, t))));
        const d = V3.dot(nn, prevN);
        if (d < 0) nn = V3.mul(nn, -1);
      }
      prevN = nn;
      frames.push({ t, n: nn, b: V3.cross(t, nn) });
    }
    // arc length
    const arc = [0];
    for (let i = 1; i < n; i++) arc.push(arc[i - 1] + V3.len(V3.sub(path[i], path[i - 1])));

    const base = this.vcount;
    for (let i = 0; i < n; i++) {
      const f = frames[i], P = path[i];
      const r = typeof radius === 'function' ? radius(i / (n - 1)) : radius;
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const dir = V3.add(V3.mul(f.n, Math.cos(a)), V3.mul(f.b, Math.sin(a)));
        const p = V3.add(P, V3.mul(dir, r));
        this.vert(p, dir, [arc[i] * s, (j / seg) * Math.PI * 2 * r * s], 1, mi);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = base + i * (seg + 1) + j;
        const b = base + i * (seg + 1) + j + 1;
        const c = base + (i + 1) * (seg + 1) + j + 1;
        const d = base + (i + 1) * (seg + 1) + j;
        this.idx.push(a, b, c, a, c, d);
      }
    }
    return this;
  }
  // torus around Y axis at centre c
  torus(c, R, r, mi, segU, segV) {
    segU = segU || 48; segV = segV || 16;
    const base = this.vcount;
    for (let i = 0; i <= segU; i++) {
      const u = (i / segU) * Math.PI * 2;
      const cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j <= segV; j++) {
        const v = (j / segV) * Math.PI * 2;
        const cv = Math.cos(v), sv = Math.sin(v);
        const n = [cu * cv, sv, su * cv];
        const p = [c[0] + (R + r * cv) * cu, c[1] + r * sv, c[2] + (R + r * cv) * su];
        this.vert(p, V3.norm(n), [u * R, v * r], 1, mi);
      }
    }
    for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
      const a = base + i * (segV + 1) + j;
      this.idx.push(a, a + 1, a + segV + 2, a, a + segV + 2, a + segV + 1);
    }
    return this;
  }
  // cylinder along Y
  cyl(c, rad, h0, h1, mi, seg, capped) {
    seg = seg || 32;
    const base = this.vcount;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      this.vert([c[0] + ca * rad, h0, c[2] + sa * rad], [ca, 0, sa], [a * rad, h0], 1, mi);
      this.vert([c[0] + ca * rad, h1, c[2] + sa * rad], [ca, 0, sa], [a * rad, h1], 1, mi);
    }
    for (let j = 0; j < seg; j++) {
      const a = base + j * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (capped) {
      for (const [y, ny] of [[h0, -1], [h1, 1]]) {
        const ci = this.vcount;
        this.vert([c[0], y, c[2]], [0, ny, 0], [0, 0], 1, mi);
        for (let j = 0; j <= seg; j++) {
          const a = (j / seg) * Math.PI * 2;
          this.vert([c[0] + Math.cos(a) * rad, y, c[2] + Math.sin(a) * rad], [0, ny, 0], [Math.cos(a) * rad, Math.sin(a) * rad], 1, mi);
        }
        for (let j = 0; j < seg; j++) {
          if (ny > 0) this.idx.push(ci, ci + 1 + j, ci + 2 + j);
          else this.idx.push(ci, ci + 2 + j, ci + 1 + j);
        }
      }
    }
    return this;
  }
  sphere(c, rad, mi, segU, segV) {
    segU = segU || 32; segV = segV || 20;
    const base = this.vcount;
    for (let i = 0; i <= segV; i++) {
      const th = (i / segV) * Math.PI;
      for (let j = 0; j <= segU; j++) {
        const ph = (j / segU) * Math.PI * 2;
        const n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
        this.vert([c[0] + n[0] * rad, c[1] + n[1] * rad, c[2] + n[2] * rad], n, [ph * rad, th * rad], 1, mi);
      }
    }
    // Skip the degenerate ring at each pole. At th = 0 and th = pi every longitude
    // collapses onto the same point, so the quads there have zero area - they cost
    // vertex processing and rasteriser setup for nothing. Emitting only one
    // triangle per pole quad, and skipping the zero-width one entirely, removes
    // ~7% of the scene's triangles.
    for (let i = 0; i < segV; i++) {
      const topRow = (i === 0);
      const botRow = (i === segV - 1);
      for (let j = 0; j < segU; j++) {
        const a = base + i * (segU + 1) + j;
        // tri1 = (row i,j ; row i+1,j ; row i+1,j+1)
        //   degenerate at the SOUTH pole (row i+1 is the collapsed ring)
        // tri2 = (row i,j ; row i+1,j+1 ; row i,j+1)
        //   degenerate at the NORTH pole (row i is the collapsed ring)
        if (!botRow) this.idx.push(a, a + segU + 1, a + segU + 2);
        if (!topRow) this.idx.push(a, a + segU + 2, a + 1);
      }
    }
    return this;
  }
  toGPU(gl) {
    const pos = new Float32Array(this.pos);
    const nrm = new Float32Array(this.nrm);
    const uv = new Float32Array(this.uv);
    const ao = new Float32Array(this.ao);
    const idx = this.vcount > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    const mk = (data) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    const bPos = mk(pos), bNrm = mk(nrm), bUV = mk(uv), bAO = mk(ao);
    const bIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bNrm); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bUV);  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bAO);  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
    gl.bindVertexArray(null);
    return { vao, count: idx.length, type: this.vcount > 65535 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, verts: this.vcount };
  }
}

// material ids
export const MAT = {
  WHITE_TILE: 0, GREEN_TILE: 1, POOL_TILE: 2, DARK_TILE: 3,
  PORCELAIN: 4, METAL: 5, PAINT: 6, CONCRETE: 7,
  TERRAZZO: 8, EMIT_SKY: 9, EMIT_WARM: 10, RING_RED: 11,
  TOY_YELLOW: 12, TOY_BLUE: 13, TOY_ORANGE: 14, TOY_WHITE: 15,
  SLIDE: 16, GLASS: 17, DARK_METAL: 18, TOWEL: 19,
  SKY: 20, WOOD: 21,
  // backrooms props
  STEEL: 22,      // locker bodies, sign posts
  EMIT_COLD: 23,  // cold fluorescent tube
  CLOCK: 24,      // clock face
  PLASTIC: 25,    // lost-property clutter
};