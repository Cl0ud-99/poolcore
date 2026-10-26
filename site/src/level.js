// ============================================================
//  LEVEL: Poolcore - a liminal indoor swimming pool
// ============================================================
import { Mesh, MAT } from './geom.js';
import { V3 } from './math.js';
import { addBackroomsProps } from './props.js';

export const WATER_Y = -0.14;
export const POOL = { x0: -6.6, x1: 6.6, z0: -15.0, z1: 15.0, floor: -4.05 };
export const HALL = { x0: -11.6, x1: 11.6, z0: -23.0, z1: 23.0, y: 9.0, vault: 2.7 };
export const SKY = { half: 3.05 };

const P = (x, y, z) => [x, y, z];

// ---------------------------------------------------------------
//  wall panel with rectangular / arched openings
// ---------------------------------------------------------------
function panel(m, opt) {
  const { axis, at, u0, u1, v0, v1, openings = [], mat, flip } = opt;
  const pt = (u, v) => axis === 'z' ? P(u, v, at) : P(at, v, u);
  const nrm = axis === 'z' ? P(0, 0, flip ? 1 : -1) : P(flip ? 1 : -1, 0, 0);

  const us = new Set([u0, u1]);
  const vs = new Set([v0, v1]);
  for (const o of openings) {
    us.add(o.u0); us.add(o.u1);
    vs.add(o.v0); vs.add(o.v1);
    if (o.arch) {
      const r = (o.u1 - o.u0) * 0.5;
      vs.add(o.v1 - r);
      for (let k = 1; k < 12; k++) vs.add(o.v1 - r + r * Math.sin((k / 12) * Math.PI * 0.5));
    }
  }
  // Sort, clamp to this panel's own range, then drop entries closer together
  // than EPS.
  //
  // The range MUST be passed explicitly. An earlier version tried to infer it
  // from the array identity (arr === us) while being handed a fresh copy
  // ([...us]), so the test was always false and the HORIZONTAL grid got filtered
  // by the VERTICAL range. Every wall line beyond the panel height was silently
  // discarded, which deleted most of the long walls and left them rendering as
  // black voids.
  const EPS = 1e-4;
  const dedupe = (arr, lo, hi) => {
    const s = arr.filter(x => x >= lo - 1e-6 && x <= hi + 1e-6).sort((a, b) => a - b);
    const out = [];
    for (const x of s) if (!out.length || Math.abs(x - out[out.length - 1]) > EPS) out.push(x);
    return out;
  };
  const U = dedupe([...us], u0, u1);
  const Vv = dedupe([...vs], v0, v1);

  const inside = (u, v) => {
    for (const o of openings) {
      if (u > o.u0 && u < o.u1) {
        if (o.arch) {
          const r = (o.u1 - o.u0) * 0.5, uc = (o.u0 + o.u1) * 0.5, spring = o.v1 - r;
          if (v > o.v0 && v < spring) return true;
          if (v >= spring && v < o.v1) {
            const du = u - uc;
            if (du * du + (v - spring) * (v - spring) < r * r) return true;
          }
        } else if (v > o.v0 && v < o.v1) return true;
      }
    }
    return false;
  };

  for (let i = 0; i < U.length - 1; i++) {
    for (let j = 0; j < Vv.length - 1; j++) {
      const cu = (U[i] + U[i + 1]) * 0.5, cv = (Vv[j] + Vv[j + 1]) * 0.5;
      if (inside(cu, cv)) continue;
      const a = pt(U[i], Vv[j]), b = pt(U[i + 1], Vv[j]), c = pt(U[i + 1], Vv[j + 1]), d = pt(U[i], Vv[j + 1]);
      const e1 = V3.sub(b, a), e2 = V3.sub(c, a);
      const cr = V3.cross(e1, e2);
      if (V3.dot(cr, nrm) >= 0) m.quad(a, b, c, d, nrm, 1, mat);
      else m.quad(a, d, c, b, nrm, 1, mat);
    }
  }
}

// a mullioned window frame filling an arched opening
function windowFrame(m, o) {
  const { axis, at, s, uc, v0, v1, w, mat, cols, rows } = o;
  const r = w * 0.5;
  const spring = v1 - r;
  const t = 0.055;
  const depth = 0.16;
  const out = at + s * depth * 0.5;
  const inAt = at + s * 0.03;
  const mkBox = (u0, u1, y0, y1) => {
    if (axis === 'z') m.box(P(Math.min(u0, u1), y0, Math.min(inAt, out)), P(Math.max(u0, u1), y1, Math.max(inAt, out)), mat, 1, {});
    else m.box(P(Math.min(inAt, out), y0, Math.min(u0, u1)), P(Math.max(inAt, out), y1, Math.max(u0, u1)), mat, 1, {});
  };
  for (let i = 1; i < cols; i++) {
    const u = uc - r + (2 * r) * (i / cols);
    mkBox(u - t * 0.5, u + t * 0.5, v0, spring + 0.02);
  }
  for (let j = 1; j < rows; j++) {
    const y = v0 + (spring - v0) * (j / rows);
    mkBox(uc - r, uc + r, y - t * 0.5, y + t * 0.5);
  }
  // arch ring
  const seg = 22;
  for (let k = 0; k < seg; k++) {
    const a0 = Math.PI * (k / seg), a1 = Math.PI * ((k + 1) / seg);
    const p0 = [uc + Math.cos(a0) * (r - t * 0.5), spring + Math.sin(a0) * (r - t * 0.5)];
    const p1 = [uc + Math.cos(a1) * (r - t * 0.5), spring + Math.sin(a1) * (r - t * 0.5)];
    const p2 = [uc + Math.cos(a1) * (r + t * 0.5), spring + Math.sin(a1) * (r + t * 0.5)];
    const p3 = [uc + Math.cos(a0) * (r + t * 0.5), spring + Math.sin(a0) * (r + t * 0.5)];
    if (axis === 'z') m.quad(P(p0[0], p0[1], out), P(p1[0], p1[1], out), P(p2[0], p2[1], out), P(p3[0], p3[1], out), P(0, 0, -s), 1, mat);
    else m.quad(P(out, p0[1], p0[0]), P(out, p1[1], p1[0]), P(out, p2[1], p2[0]), P(out, p3[1], p3[0]), P(-s, 0, 0), 1, mat);
  }
  mkBox(uc - r, uc - r + t, v0, spring);
  mkBox(uc + r - t, uc + r, v0, spring);
  mkBox(uc - r - 0.09, uc + r + 0.09, v0 - 0.09, v0);
}

// ---------------------------------------------------------------
//  build
// ---------------------------------------------------------------
export function buildLevel() {
  const m = new Mesh();
  const lights = [];
  const portals = [];
  const H = HALL;
  const DECK_Y = 0.0;

  // ---------- deck floor ----------
  const deckQuad = (x0, x1, z0, z1) => {
    m.quad(P(x0, DECK_Y, z0), P(x1, DECK_Y, z0), P(x1, DECK_Y, z1), P(x0, DECK_Y, z1), P(0, 1, 0), 1, MAT.TERRAZZO);
  };
  deckQuad(H.x0, POOL.x0, H.z0, H.z1);
  deckQuad(POOL.x1, H.x1, H.z0, H.z1);
  deckQuad(POOL.x0, POOL.x1, H.z0, POOL.z0);
  deckQuad(POOL.x0, POOL.x1, POOL.z1, H.z1);

  // ---------- pool interior ----------
  const pw = (a, b, c, d, n, mat) => m.quad(a, b, c, d, n, 1, mat);
  pw(P(POOL.x0, POOL.floor, POOL.z0), P(POOL.x0, POOL.floor, POOL.z1), P(POOL.x0, DECK_Y, POOL.z1), P(POOL.x0, DECK_Y, POOL.z0), P(1, 0, 0), MAT.POOL_TILE);
  pw(P(POOL.x1, POOL.floor, POOL.z1), P(POOL.x1, POOL.floor, POOL.z0), P(POOL.x1, DECK_Y, POOL.z0), P(POOL.x1, DECK_Y, POOL.z1), P(-1, 0, 0), MAT.POOL_TILE);
  pw(P(POOL.x1, POOL.floor, POOL.z0), P(POOL.x0, POOL.floor, POOL.z0), P(POOL.x0, DECK_Y, POOL.z0), P(POOL.x1, DECK_Y, POOL.z0), P(0, 0, 1), MAT.POOL_TILE);
  pw(P(POOL.x0, POOL.floor, POOL.z1), P(POOL.x1, POOL.floor, POOL.z1), P(POOL.x1, DECK_Y, POOL.z1), P(POOL.x0, DECK_Y, POOL.z1), P(0, 0, -1), MAT.POOL_TILE);
  pw(P(POOL.x0, POOL.floor, POOL.z1), P(POOL.x1, POOL.floor, POOL.z1), P(POOL.x1, POOL.floor, POOL.z0), P(POOL.x0, POOL.floor, POOL.z0), P(0, 1, 0), MAT.POOL_TILE);

  // dark tile band just under the coping, all round the pool
  {
    const bandY = [-0.02, 0.26];
    // Nudge the band a few millimetres off the basin wall. It is meant to be a
    // surface decal; sharing the wall's exact plane made it z-fight along the
    // entire waterline, which is the shimmering stripe just under the coping.
    const B = 0.004;
    const band = (a, b, c, d, n) => m.quad(a, b, c, d, n, 1, MAT.DARK_TILE);
    band(P(POOL.x0 + B, bandY[0], POOL.z0), P(POOL.x0 + B, bandY[0], POOL.z1), P(POOL.x0 + B, bandY[1], POOL.z1), P(POOL.x0 + B, bandY[1], POOL.z0), P(1, 0, 0));
    band(P(POOL.x1 - B, bandY[0], POOL.z1), P(POOL.x1 - B, bandY[0], POOL.z0), P(POOL.x1 - B, bandY[1], POOL.z0), P(POOL.x1 - B, bandY[1], POOL.z1), P(-1, 0, 0));
    band(P(POOL.x1, bandY[0], POOL.z0 + B), P(POOL.x0, bandY[0], POOL.z0 + B), P(POOL.x0, bandY[1], POOL.z0 + B), P(POOL.x1, bandY[1], POOL.z0 + B), P(0, 0, 1));
    band(P(POOL.x0, bandY[0], POOL.z1 - B), P(POOL.x1, bandY[0], POOL.z1 - B), P(POOL.x1, bandY[1], POOL.z1 - B), P(POOL.x0, bandY[1], POOL.z1 - B), P(0, 0, -1));
  }

  // lane lines on the pool floor
  for (const lx of [-4.4, -1.5, 1.5, 4.4]) {
    m.quad(P(lx - 0.12, POOL.floor + 0.004, POOL.z0 + 0.3), P(lx + 0.12, POOL.floor + 0.004, POOL.z0 + 0.3),
           P(lx + 0.12, POOL.floor + 0.004, POOL.z1 - 0.3), P(lx - 0.12, POOL.floor + 0.004, POOL.z1 - 0.3), P(0, 1, 0), 1, MAT.DARK_TILE);
  }
  for (const zz of [POOL.z0 + 1.2, POOL.z1 - 1.2]) {
    for (const lx of [-4.4, -1.5, 1.5, 4.4]) {
      m.quad(P(lx - 0.55, POOL.floor + 0.004, zz - 0.12), P(lx + 0.55, POOL.floor + 0.004, zz - 0.12),
             P(lx + 0.55, POOL.floor + 0.004, zz + 0.12), P(lx - 0.55, POOL.floor + 0.004, zz + 0.12), P(0, 1, 0), 1, MAT.DARK_TILE);
    }
  }

  // ---------- pool coping ----------
  const cop = (x0, x1, z0, z1) => {
    // Skip the faces that coincide with the basin wall / deck. The coping is a
    // band around the pool edge, so its inner and underside faces are always
    // hidden by geometry that is already there - keeping them only creates
    // coplanar pairs that z-fight.
    let skip = '-y';
    if (Math.abs(x0 - POOL.x0) < 1e-6) skip += '+x';
    if (Math.abs(x1 - POOL.x1) < 1e-6) skip += '-x';
    if (Math.abs(z0 - POOL.z0) < 1e-6) skip += '+z';
    if (Math.abs(z1 - POOL.z1) < 1e-6) skip += '-z';
    m.box(P(x0, DECK_Y - 0.03, z0), P(x1, DECK_Y + 0.07, z1), MAT.PORCELAIN, 1, { skip });
  };
  cop(POOL.x0 - 0.38, POOL.x0, POOL.z0 - 0.38, POOL.z1 + 0.38);
  cop(POOL.x1, POOL.x1 + 0.38, POOL.z0 - 0.38, POOL.z1 + 0.38);
  cop(POOL.x0, POOL.x1, POOL.z0 - 0.38, POOL.z0);
  cop(POOL.x0, POOL.x1, POOL.z1, POOL.z1 + 0.38);
  // overflow gutter slot
  for (const s of [-1, 1]) {
    const x = s * (POOL.x1 + 0.38);
    // Raised 2 mm above the coping so it reads as a slot rather than fighting
    // with the coping top face it used to share a plane with.
    const gy = DECK_Y + 0.072;
    m.quad(P(x - 0.02, gy, POOL.z0), P(x + s * 0.16, gy, POOL.z0),
           P(x + s * 0.16, gy, POOL.z1), P(x - 0.02, gy, POOL.z1), P(0, 1, 0), 1, MAT.DARK_TILE);
  }

  // ---------- long walls ----------
  const winRow = [];
  for (let i = 0; i < 10; i++) {
    const z = -18.0 + i * 4.0;
    winRow.push({ u0: z - 0.85, u1: z + 0.85, v0: 3.20, v1: 6.85, arch: true });
  }
  const hiRow = [];
  for (let i = 0; i < 19; i++) {
    const z = -21.0 + i * 2.35;
    hiRow.push({ u0: z - 0.50, u1: z + 0.50, v0: 7.45, v1: 8.32, arch: false });
  }
  const REVEAL = 0.26;
  for (const s of [-1, 1]) {
    const at = s * H.x1;
    panel(m, { axis: 'x', at, u0: H.z0, u1: H.z1, v0: -0.02, v1: 1.58, openings: [], mat: MAT.GREEN_TILE, flip: s < 0 });
    panel(m, { axis: 'x', at, u0: H.z0, u1: H.z1, v0: 1.58, v1: H.y + 0.35, openings: [...winRow, ...hiRow], mat: MAT.WHITE_TILE, flip: s < 0 });

    for (const w of [...winRow, ...hiRow]) {
      const zc = (w.u0 + w.u1) * 0.5, r = (w.u1 - w.u0) * 0.5;
      const spring = w.v1 - (w.arch ? r : 0);
      const nrm = P(-s, 0, 0);
      const off = s * REVEAL;
      if (w.arch) {
        m.quad(P(at + off, w.v0, zc - r), P(at + off, w.v0, zc + r), P(at + off, spring, zc + r), P(at + off, spring, zc - r), nrm, 1, MAT.SKY);
        const seg = 16;
        for (let k = 0; k < seg; k++) {
          const a0 = Math.PI * (k / seg), a1 = Math.PI * ((k + 1) / seg);
          m.tri(P(at + off, spring, zc), P(at + off, spring + Math.sin(a0) * r, zc + Math.cos(a0) * r),
                P(at + off, spring + Math.sin(a1) * r, zc + Math.cos(a1) * r), nrm, 1, MAT.SKY);
        }
      } else {
        m.quad(P(at + off, w.v0, zc - r), P(at + off, w.v0, zc + r), P(at + off, w.v1, zc + r), P(at + off, w.v1, zc - r), nrm, 1, MAT.SKY);
      }
      // deep reveal
      const vTop = w.v1;
      // The reveal starts a hair INSIDE the opening (EPS) instead of exactly on the
      // wall plane. Coplanar with the wall panel, these two faces z-fight along
      // the whole window edge - which is the flickering seam visible around every
      // arch.
      const EPS = 0.004;
      const inAt = at + Math.sign(off) * EPS;
      m.quad(P(inAt, w.v0, zc - r), P(at + off, w.v0, zc - r), P(at + off, vTop, zc - r), P(inAt, vTop, zc - r), P(0, 0, 1), 1, MAT.PORCELAIN);
      m.quad(P(at + off, w.v0, zc + r), P(inAt, w.v0, zc + r), P(inAt, vTop, zc + r), P(at + off, vTop, zc + r), P(0, 0, -1), 1, MAT.PORCELAIN);
      m.quad(P(at, vTop, zc - r), P(at, vTop, zc + r), P(at + off, vTop, zc + r), P(at + off, vTop, zc - r), P(0, -1, 0), 1, MAT.WHITE_TILE);
      m.quad(P(at, w.v0, zc - r), P(at, w.v0, zc + r), P(at + off, w.v0, zc + r), P(at + off, w.v0, zc - r), P(0, 1, 0), 1, MAT.PORCELAIN);
      windowFrame(m, { axis: 'x', at, s, uc: zc, v0: w.v0, v1: w.v1, w: w.u1 - w.u0, mat: MAT.DARK_METAL, cols: w.arch ? 3 : 2, rows: w.arch ? 4 : 1 });
      portals.push({
        pos: [at + s * 0.35, (w.v0 + w.v1) * 0.5, zc],
        radius: r * (w.arch ? 1.05 : 0.9),
        nrm: [-s, 0, 0],
        color: [0.78, 0.86, 1.0],
        intensity: w.arch ? 30.0 : 12.0,
      });
    }
  }

  // ---------- end walls ----------
  const endWin = [];
  for (const zc of [-7.4, 0.0, 7.4]) endWin.push({ u0: zc - 1.80, u1: zc + 1.80, v0: 2.2, v1: 8.0, arch: true });
  for (const s of [-1, 1]) {
    const at = s * H.z1;
    panel(m, { axis: 'z', at, u0: H.x0, u1: H.x1, v0: -0.02, v1: 1.58, openings: [], mat: MAT.GREEN_TILE, flip: s < 0 });
    panel(m, { axis: 'z', at, u0: H.x0, u1: H.x1, v0: 1.58, v1: H.y + H.vault + 0.6, openings: endWin, mat: MAT.WHITE_TILE, flip: s < 0 });
    for (const w of endWin) {
      const xc = (w.u0 + w.u1) * 0.5, r = (w.u1 - w.u0) * 0.5;
      const spring = w.v1 - r;
      const nrm = P(0, 0, -s);
      const off = s * 1.05;
      m.quad(P(xc - r, w.v0, at + off), P(xc + r, w.v0, at + off), P(xc + r, spring, at + off), P(xc - r, spring, at + off), nrm, 1, MAT.SKY);
      const seg = 18;
      for (let k = 0; k < seg; k++) {
        const a0 = Math.PI * (k / seg), a1 = Math.PI * ((k + 1) / seg);
        m.tri(P(xc, spring, at + off), P(xc + Math.cos(a0) * r, spring + Math.sin(a0) * r, at + off),
              P(xc + Math.cos(a1) * r, spring + Math.sin(a1) * r, at + off), nrm, 1, MAT.SKY);
      }
      m.quad(P(xc - r, w.v0, at), P(xc - r, w.v0, at + off), P(xc - r, w.v1, at + off), P(xc - r, w.v1, at), P(1, 0, 0), 1, MAT.WHITE_TILE);
      m.quad(P(xc + r, w.v0, at + off), P(xc + r, w.v0, at), P(xc + r, w.v1, at), P(xc + r, w.v1, at + off), P(-1, 0, 0), 1, MAT.WHITE_TILE);
      m.quad(P(xc - r, w.v1, at), P(xc + r, w.v1, at), P(xc + r, w.v1, at + off), P(xc - r, w.v1, at + off), P(0, -1, 0), 1, MAT.WHITE_TILE);
      m.quad(P(xc - r, w.v0, at), P(xc + r, w.v0, at), P(xc + r, w.v0, at + off), P(xc - r, w.v0, at + off), P(0, 1, 0), 1, MAT.PORCELAIN);
      windowFrame(m, { axis: 'z', at, s, uc: xc, v0: w.v0, v1: w.v1, w: w.u1 - w.u0, mat: MAT.DARK_METAL, cols: 4, rows: 5 });
      portals.push({
        pos: [xc, (w.v0 + w.v1) * 0.5, at + s * 0.4],
        radius: r * 1.05,
        nrm: [0, 0, -s],
        color: [0.80, 0.88, 1.0],
        intensity: 52.0,
      });
    }
  }

  // ---------- barrel vault ceiling ----------
  {
    const N = 40, Z0 = H.z0, Z1 = H.z1;
    const yOf = (x) => H.y + H.vault * (1 - (x / H.x1) * (x / H.x1));
    const nOf = (x) => V3.norm(P(-2 * H.vault * x / (H.x1 * H.x1), -1, 0));
    for (let i = 0; i < N; i++) {
      const xa = H.x0 + (H.x1 - H.x0) * (i / N);
      const xb = H.x0 + (H.x1 - H.x0) * ((i + 1) / N);
      const xm = (xa + xb) * 0.5;
      const isSky = Math.abs(xm) < SKY.half;
      const mat = isSky ? MAT.SKY : MAT.PAINT;
      m.quad(P(xa, yOf(xa), Z0), P(xb, yOf(xb), Z0), P(xb, yOf(xb), Z1), P(xa, yOf(xa), Z1), nOf(xm), 1, mat);
    }
    for (const sx of [-1, 1]) {
      const x = sx * SKY.half;
      const y = yOf(x);
      m.quad(P(x, y, Z0), P(x, y, Z1), P(x, y + 0.62, Z1), P(x, y + 0.62, Z0), P(-sx, 0, 0), 1, MAT.PAINT);
    }
    // Transverse ribs. Over the skylight they are drawn much deeper than the
    // decorative ones on the vault shoulders: a 0.32 m rib under a near-vertical
    // sun only shades a 0.32 m band, so the seven skylight panels merged into one
    // continuous wall of haze. Deep mullions are what break the strip into
    // separate, readable sun shafts.
    for (let i = 0; i <= 12; i++) {
      const z = Z0 + (Z1 - Z0) * (i / 12);
      for (let k = 0; k < N; k++) {
        const xa = H.x0 + (H.x1 - H.x0) * (k / N);
        const xb = H.x0 + (H.x1 - H.x0) * ((k + 1) / N);
        const xm = (xa + xb) * 0.5;
        const deep = Math.abs(xm) < SKY.half + 0.02;
        const d = deep ? 0.72 : 0.32;
        const ya = yOf(xa) - 0.02, yb = yOf(xb) - 0.02;
        m.quad(P(xa, ya - d, z), P(xb, yb - d, z), P(xb, yb, z), P(xa, ya, z), P(0, 0, 1), 1, MAT.PAINT);
        m.quad(P(xb, yb - d, z + 0.32), P(xa, ya - d, z + 0.32), P(xa, ya, z + 0.32), P(xb, yb, z + 0.32), P(0, 0, -1), 1, MAT.PAINT);
        if (deep) {
          // soffit: without it the mullion reads as a floating plate
          m.quad(P(xa, ya - d, z), P(xa, ya - d, z + 0.32), P(xb, yb - d, z + 0.32), P(xb, yb - d, z), P(0, -1, 0), 1, MAT.PAINT);
        }
        if (k === 0 || k === N - 1) m.quad(P(xa, ya - d, z), P(xa, ya - d, z + 0.32), P(xa, ya, z + 0.32), P(xa, ya, z), P(-1, 0, 0), 1, MAT.PAINT);
      }
    }
    // skylight glow sources (a few, spread along the strip)
    for (const z of [-18, -12, -6, 0, 6, 12, 18]) {
      portals.push({
        pos: [0, H.y + H.vault + 0.1, z], radius: 2.3,
        nrm: [0, -1, 0], color: [0.88, 0.92, 1.0], intensity: 62.0,
      });
    }
  }

  // ---------- colonnade ----------
  const COL_Z = [-18, -12, -6, 0, 6, 12, 18];
  const COL_X = 8.5;
  for (const s of [-1, 1]) {
    for (const z of COL_Z) {
      const x = s * COL_X;
      m.box(P(x - 0.58, 0, z - 0.58), P(x + 0.58, 7.62, z + 0.58), MAT.WHITE_TILE, 1, { skip: '-y+y' });
      m.box(P(x - 0.70, 0, z - 0.70), P(x + 0.70, 0.14, z + 0.70), MAT.PORCELAIN, 1, { skip: '-y' });
      m.box(P(x - 0.70, 7.62, z - 0.70), P(x + 0.70, 7.98, z + 0.70), MAT.PORCELAIN, 1, { skip: '+y-y' });
      m.box(P(x - 0.84, 7.98, z - 0.84), P(x + 0.84, 8.42, z + 0.84), MAT.PAINT, 1, { skip: '-y' });
      // sconce on the pool side
      const lx = x - s * 0.94, ly = 4.55;
      m.sphere(P(lx, ly, z), 0.17, MAT.EMIT_WARM, 24, 18);
      m.cyl(P(lx, 0, z), 0.030, ly - 0.18, ly - 0.04, MAT.DARK_METAL, 8, false);
      m.cyl(P(lx, 0, z), 0.15, ly - 0.05, ly - 0.01, MAT.DARK_METAL, 18, false);
      lights.push({ pos: [lx - s * 0.24, ly, z], color: [1.0, 0.76, 0.50], intensity: 16.0, radius: 0.22 });
    }
    const bx = s * COL_X;
    m.box(P(bx - 0.9, 8.42, H.z0), P(bx + 0.9, 9.05, H.z1), MAT.PAINT, 1, {});
    // Beam soffit. This used to be MAT.DARK_TILE, which under the current exposure
    // rendered as a solid black bar across the top of frame. Real bath houses trim
    // the beam in the same glazed white as the vault, and the cast shadow under it
    // is what gives the beam its weight.
    m.box(P(bx - 0.96, 8.34, H.z0), P(bx + 0.96, 8.43, H.z1), MAT.PAINT, 1, {});
  }

  // ---------- wall sconces on the long walls (rows like the reference) ----------
  for (const s of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      const z = -20 + i * 4.0;
      const x = s * (H.x1 - 0.16), y = 2.62;
      m.cyl(P(x, 0, z), 0.07, y - 0.42, y - 0.36, MAT.PORCELAIN, 12, false);
      m.sphere(P(x - s * 0.06, y, z), 0.13, MAT.EMIT_WARM, 20, 14);
      lights.push({ pos: [x - s * 0.30, y, z], color: [1.0, 0.79, 0.56], intensity: 9.0, radius: 0.18 });
    }
  }

  // ---------- deck railings (chrome) ----------
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const cnt = Math.max(2, Math.round(len / 1.8));
    for (let i = 0; i <= cnt; i++) {
      const t = i / cnt;
      const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
      m.cyl(P(px, 0, pz), 0.026, 0.02, 1.02, MAT.METAL, 10, true);
    }
    const a = P(x0, 1.02, z0), b = P(x1, 1.02, z1);
    m.tube([a, V3.lerp(a, b, 0.5), b], 0.028, MAT.METAL, 10, 1, false);
    const a2 = P(x0, 0.56, z0), b2 = P(x1, 0.56, z1);
    m.tube([a2, V3.lerp(a2, b2, 0.5), b2], 0.020, MAT.METAL, 8, 1, false);
  };
  rail(-9.4, -21.6, -9.4, -16.2);
  rail(-9.4, 16.2, -9.4, 21.6);
  rail(9.4, -21.6, 9.4, -16.2);
  rail(9.4, 16.2, 9.4, 21.6);

  // ---------- pool ladders ----------
  const ladder = (x, z, sgn) => {
    for (const dz of [-0.26, 0.26]) {
      const pts = [
        P(x - sgn * 0.05, 0.86, z + dz),
        P(x - sgn * 0.44, 1.04, z + dz),
        P(x + sgn * 0.28, 0.56, z + dz),
        P(x + sgn * 0.44, -0.05, z + dz),
        // Rail must reach the new, deeper floor (was -0.80).
        P(x + sgn * 0.44, -3.90, z + dz),
      ];
      const curve = [];
      for (let i = 0; i <= 22; i++) {
        const t = i / 22;
        const seg = Math.min(pts.length - 2, Math.floor(t * (pts.length - 1)));
        const lt = t * (pts.length - 1) - seg;
        const p0 = pts[Math.max(0, seg - 1)], p1 = pts[seg], p2 = pts[Math.min(pts.length - 1, seg + 1)], p3 = pts[Math.min(pts.length - 1, seg + 2)];
        const t2 = lt * lt, t3 = t2 * lt;
        curve.push([0, 1, 2].map(k => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * lt + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
      m.tube(curve, 0.025, MAT.METAL, 8, 1, false);
    }
    // More rungs, spaced to span the deeper basin.
    for (let i = 0; i < 7; i++) {
      const y = -0.38 - i * 0.52;
      m.cyl(P(x + sgn * 0.44, 0, z), 0.021, y - 0.02, y + 0.02, MAT.METAL, 8, true);
      m.tube([P(x + sgn * 0.44, y, z - 0.26), P(x + sgn * 0.44, y, z + 0.26)], 0.019, MAT.METAL, 8, 1, true);
    }
  };
  ladder(POOL.x0 + 0.44, 8.6, -1);
  ladder(POOL.x1 - 0.44, -8.6, 1);

  // ---------- red ring tower ----------
  {
    const cx = 0.0, cz = 5.6;
    const ys = [WATER_Y + 0.16, WATER_Y + 0.74, WATER_Y + 1.30, WATER_Y + 1.84];
    const rr = [1.30, 1.22, 1.12, 0.96];
    for (let i = 0; i < ys.length; i++) {
      const wob = Math.sin(i * 2.1) * 0.05;
      m.torus(P(cx + wob, ys[i], cz + Math.cos(i * 1.7) * 0.04), rr[i], 0.285, MAT.RING_RED, 80, 32);
    }
  }

  // ---------- floating pool toys ----------
  const floatRing = (x, z, R, r, mat, tilt) => {
    const base = m.vcount;
    m.torus(P(0, 0, 0), R, r, mat, 56, 20);
    const nv = m.vcount - base;
    for (let i = 0; i < nv; i++) {
      const o = (base + i) * 3;
      const px = m.pos[o], py = m.pos[o + 1], pz = m.pos[o + 2];
      const c = Math.cos(tilt), s = Math.sin(tilt);
      const ry = py * c - pz * s, rz = py * s + pz * c;
      m.pos[o] = px + x; m.pos[o + 1] = ry + WATER_Y + 0.050; m.pos[o + 2] = rz + z;
      const nx = m.nrm[o], ny = m.nrm[o + 1], nz = m.nrm[o + 2];
      m.nrm[o] = nx; m.nrm[o + 1] = ny * c - nz * s; m.nrm[o + 2] = ny * s + nz * c;
    }
  };
  floatRing(-3.4, 1.2, 0.46, 0.145, MAT.TOY_YELLOW, 0.05);
  floatRing(3.9, -3.6, 0.42, 0.135, MAT.TOY_BLUE, -0.07);
  floatRing(2.3, -9.2, 0.44, 0.14, MAT.TOY_ORANGE, 0.03);
  floatRing(-4.6, -6.4, 0.40, 0.13, MAT.TOY_WHITE, -0.04);
  floatRing(-1.2, -11.8, 0.38, 0.125, MAT.TOY_ORANGE, 0.02);

  // ---------- big red barrel float (reference #4) ----------
  {
    const bx = -5.0, bz = -12.2;
    const R = 0.62, L = 1.55;
    const base = m.vcount;
    m.cyl(P(0, 0, 0), R, -L * 0.5, L * 0.5, MAT.RING_RED, 32, false);
    m.sphere(P(0, -L * 0.5, 0), R, MAT.RING_RED, 32, 16);
    const capB = m.vcount;
    m.sphere(P(0, L * 0.5, 0), R, MAT.RING_RED, 32, 16);
    const nv = m.vcount - base;
    const yaw = 0.5, roll = 0.12;
    for (let i = 0; i < nv; i++) {
      const o = (base + i) * 3;
      let px = m.pos[o], py = m.pos[o + 1], pz = m.pos[o + 2];
      // squash the cap spheres onto the barrel
      if (base + i >= capB) py = Math.min(py, L * 0.5);
      let x2 = px * Math.cos(yaw) + pz * Math.sin(yaw);
      let z2 = -px * Math.sin(yaw) + pz * Math.cos(yaw);
      let y2 = py * Math.cos(roll) - z2 * Math.sin(roll);
      let z3 = py * Math.sin(roll) + z2 * Math.cos(roll);
      m.pos[o] = x2 + bx; m.pos[o + 1] = y2 + WATER_Y + 0.12; m.pos[o + 2] = z3 + bz;
      const nx = m.nrm[o], ny = m.nrm[o + 1], nz = m.nrm[o + 2];
      const nx2 = nx * Math.cos(yaw) + nz * Math.sin(yaw);
      const nz2 = -nx * Math.sin(yaw) + nz * Math.cos(yaw);
      const ny2 = ny * Math.cos(roll) - nz2 * Math.sin(roll);
      const nz3 = ny * Math.sin(roll) + nz2 * Math.cos(roll);
      m.nrm[o] = nx2; m.nrm[o + 1] = ny2; m.nrm[o + 2] = nz3;
    }
  }

  // ---------- lane ropes ----------
  {
    const laneZ = [-10.5, -6.5, -2.5, 2.5, 6.5, 10.5];
    for (let li = 0; li < laneZ.length; li++) {
      const z = laneZ[li];
      const col = (li % 2 === 0) ? MAT.TOY_BLUE : MAT.TOY_WHITE;
      const n = 46;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = POOL.x0 + 0.5 + (POOL.x1 - POOL.x0 - 1.0) * t;
        const sag = Math.sin(t * Math.PI) * 0.035;
        const y = WATER_Y + 0.055 - sag + Math.sin(t * 40.0 + li) * 0.006;
        const rr = 0.050;
        if (i < n) {
          const b = m.vcount;
          m.sphere(P(x, y, z), rr, (i % 6 === 0) ? col : ((li % 2 === 0) ? MAT.TOY_WHITE : MAT.TOY_ORANGE), 10, 7);
          const nv = m.vcount - b;
          for (let k = 0; k < nv; k++) {
            const o = (b + k) * 3;
            m.pos[o + 1] = y + (m.pos[o + 1] - y) * 0.72;
          }
        }
      }
      m.tube([P(POOL.x0 + 0.4, WATER_Y + 0.06, z), P(0, WATER_Y + 0.025, z), P(POOL.x1 - 0.4, WATER_Y + 0.06, z)], 0.012, MAT.DARK_METAL, 6, 1, false);
    }
  }

  // ---------- water slide ----------
  {
    const path = [];
    const C = P(4.2, 0, -6.2);
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const ang = -Math.PI * 0.62 + t * Math.PI * 2.35;
      const rad = 5.0 - 3.5 * t;
      const y = 7.9 - 8.0 * t;
      path.push(P(C[0] + Math.cos(ang) * rad, y, C[2] + Math.sin(ang) * rad));
    }
    path.push(P(2.6, -0.05, -2.0));
    path.push(P(2.2, -0.55, -0.4));
    m.tube(path, (t) => 0.46 + 0.12 * t, MAT.SLIDE, 24, 1, false);
    m.box(P(C[0] - 1.6, 7.7, C[2] - 5.4), P(C[0] + 1.6, 8.02, C[2] - 2.2), MAT.PAINT, 1, {});
    for (const dx of [-1.3, 1.3]) for (const dz of [-5.0, -2.6]) {
      m.cyl(P(C[0] + dx, 0, C[2] + dz), 0.11, 0, 7.7, MAT.WHITE_TILE, 12, false);
    }
  }

  // ---------- far end: submerged steps ----------
  // Steps must actually descend to the new floor. The old loop stopped at
  // -1.12 m, which would have left them floating a metre and a half above the
  // basin once the depth increased.
  {
    // A proper submerged staircase. Each tread is a solid block running from the
    // basin floor up to its own step height, so consecutive blocks share a
    // vertical face instead of intersecting. The old version used thin floating
    // slabs spaced 0.52 m apart in z while being 0.60 m deep (0.08 m of overlap
    // per step) and 0.251 m tall on a 0.405 m rise (0.154 m open gap), which
    // produced both the z-fighting and the holes you could see the wall through.
    const stepCount = 8;
    const treadDepth = 0.46;                 // z extent of one tread
    const zStart = POOL.z1 - 1.55;
    const rise = (DECK_Y - POOL.floor) / (stepCount + 1);
    for (let i = 0; i < stepCount; i++) {
      const topY = DECK_Y - rise * (i + 1);
      const z0 = zStart - i * treadDepth;
      const z1 = z0 + treadDepth;
      m.box(
        P(POOL.x0 + 0.02, POOL.floor, z0),
        P(POOL.x0 + 3.2, topY, z1),
        MAT.POOL_TILE, 1, {}
      );
    }
  }

  // ---------- ceiling pendant lamps over the pool ----------
  for (const z of [-12, -4, 4, 12]) {
    for (const x of [-4.8, 4.8]) {
      const yTop = H.y + H.vault * (1 - (x / H.x1) * (x / H.x1));
      m.cyl(P(x, 0, z), 0.016, yTop - 2.6, yTop - 0.05, MAT.METAL, 6, false);
      m.sphere(P(x, yTop - 2.74, z), 0.19, MAT.EMIT_WARM, 22, 16);
      m.cyl(P(x, 0, z), 0.17, yTop - 2.90, yTop - 2.85, MAT.DARK_METAL, 18, false);
      lights.push({ pos: [x, yTop - 3.05, z], color: [1.0, 0.82, 0.60], intensity: 12.0, radius: 0.2 });
    }
  }

  // ---------- bench + towels on the deck ----------
  const bench = (x, z, rot) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    const X = (dx, dz) => x + dx * c - dz * s;
    const Z = (dx, dz) => z + dx * s + dz * c;
    m.box(P(X(-0.9, -0.28), 0.42, Z(-0.9, -0.28)), P(X(0.9, 0.28), 0.50, Z(0.9, 0.28)), MAT.WOOD, 1, {});
    for (const dx of [-0.78, 0.78]) for (const dz of [-0.22, 0.22]) {
      m.cyl(P(X(dx, dz), 0, Z(dx, dz)), 0.022, 0, 0.42, MAT.DARK_METAL, 8, false);
    }
    m.box(P(X(-0.75, -0.24), 0.50, Z(-0.75, -0.24)), P(X(0.1, 0.24), 0.545, Z(0.1, 0.24)), MAT.TOWEL, 1, {});
  };
  bench(-9.0, 2.0, 0.0);
  bench(9.0, -2.0, 0.0);
  bench(-9.0, -9.0, 0.0);

  // ---------- backrooms props ----------
  // Scattered from a fixed seed: lockers, empty ring hooks, stopped clocks,
  // crooked signs, cold tubes, and lost-property clutter on the deck.
  addBackroomsProps(m, lights, H);

  return { mesh: m, lights, portals };
}
