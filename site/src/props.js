// ============================================================
//  BACKROOMS PROPS: scattered, deterministic, deliberately imperfect
// ============================================================
//
// Everything here is placed from a FIXED seed, so the scene is identical on
// every load and every screenshot. Random-looking, never random.
//
// The design rule is "someone was here and left in a hurry": lockers with doors
// hanging open, hooks where the life rings used to hang, a clock stopped at an
// odd minute, a sign knocked crooked. Nothing is centred, nothing is level.
import { MAT } from './geom.js';
import { V3, mulberry32 } from './math.js';

const P = (x, y, z) => [x, y, z];

// ---------------------------------------------------------------
//  locker bank: painted steel, doors ajar or missing
// ---------------------------------------------------------------
function lockerBank(m, rand, x, z, count, facing, yaw) {
  const W = 0.42, H = 1.86, D = 0.46;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // local -> world, so a bank can sit along any wall at any angle
  const L = (lx, lz) => [x + lx * c - lz * s, z + lx * s + lz * c];

  for (let i = 0; i < count; i++) {
    const lx = (i - (count - 1) * 0.5) * W;
    // slight per-locker lean: a perfectly plumb bank reads as CG
    const lean = (rand() - 0.5) * 0.014;
    const p0 = L(lx - W * 0.5, -D * 0.5);
    const p1 = L(lx + W * 0.5, D * 0.5);

    m.box(
      P(Math.min(p0[0], p1[0]), lean, Math.min(p0[1], p1[1])),
      P(Math.max(p0[0], p1[0]), H + lean, Math.max(p0[1], p1[1])),
      MAT.STEEL, 1, {}
    );

    // door: closed, ajar, or gone
    const roll = rand();
    if (roll < 0.42) {
      // ajar - hinge on one side, swung outward by 15..55 degrees
      const ang = (0.26 + rand() * 0.70) * (rand() < 0.5 ? 1 : -1);
      const hingeX = lx - W * 0.5 * Math.sign(ang);
      const dw = W * 0.94, dh = H * 0.92;
      const h0 = L(hingeX, facing * (D * 0.5 + 0.01));
      const ex = h0[0] + Math.cos(ang) * dw * c - Math.sin(ang) * dw * s * facing;
      const ez = h0[1] + Math.cos(ang) * dw * s + Math.sin(ang) * dw * c * facing;
      m.box(
        P(Math.min(h0[0], ex) - 0.008, lean + 0.05, Math.min(h0[1], ez) - 0.008),
        P(Math.max(h0[0], ex) + 0.008, lean + 0.05 + dh, Math.max(h0[1], ez) + 0.008),
        MAT.STEEL, 1, {}
      );
    } else if (roll < 0.60) {
      // door missing entirely - just the dark cavity reads through
      const h0 = L(lx - W * 0.42, facing * D * 0.48);
      const h1 = L(lx + W * 0.42, facing * D * 0.52);
      m.quad(
        P(h0[0], 0.06, h0[1]), P(h1[0], 0.06, h1[1]),
        P(h1[0], H * 0.86, h1[1]), P(h0[0], H * 0.86, h0[1]),
        P(-facing * s, 0, -facing * c), 1, MAT.DARK_METAL
      );
    }
    // vent slot near the top of every locker
    const v0 = L(lx - W * 0.3, facing * (D * 0.5 + 0.006));
    const v1 = L(lx + W * 0.3, facing * (D * 0.5 + 0.006));
    m.quad(
      P(v0[0], H * 0.82, v0[1]), P(v1[0], H * 0.82, v1[1]),
      P(v1[0], H * 0.86, v1[1]), P(v0[0], H * 0.86, v0[1]),
      P(-facing * s, 0, -facing * c), 1, MAT.DARK_METAL
    );
  }
  // bench plinth in front of the bank
  const b0 = L(-count * 0.5 * W, facing * (D * 0.5 + 0.34));
  const b1 = L(count * 0.5 * W, facing * (D * 0.5 + 0.72));
  m.box(
    P(Math.min(b0[0], b1[0]), 0.0, Math.min(b0[1], b1[1])),
    P(Math.max(b0[0], b1[0]), 0.44, Math.max(b0[1], b1[1])),
    MAT.WOOD, 1, {}
  );
}

// ---------------------------------------------------------------
//  life-ring hook rail: most rings gone, hooks left behind
// ---------------------------------------------------------------
function hookRail(m, rand, x, y, z, axis, len, facing) {
  const n = Math.max(3, Math.round(len / 0.85));
  const along = axis === 'z'
    ? (t) => P(x, y, z + t)
    : (t) => P(x + t, y, z);

  // rail
  const a = along(-len * 0.5), b = along(len * 0.5);
  m.tube([a, V3.lerp(a, b, 0.5), b], 0.021, MAT.DARK_METAL, 8, 1, false);

  for (let i = 0; i < n; i++) {
    const t = (i - (n - 1) * 0.5) * (len / (n - 1 || 1));
    const hook = along(t);
    // hook: short stem + small curl
    const stemEnd = axis === 'z'
      ? P(hook[0] - facing * 0.11, hook[1] - 0.055, hook[2])
      : P(hook[0], hook[1] - 0.055, hook[2] - facing * 0.11);
    m.tube([hook, stemEnd], 0.012, MAT.DARK_METAL, 6, 1, false);

    // only some hooks still hold a ring - the gaps are the point
    if (rand() < 0.28) {
      const cx = axis === 'z' ? stemEnd[0] : stemEnd[0] + facing * 0.30;
      const cz = axis === 'z' ? stemEnd[2] + facing * 0.30 : stemEnd[2];
      const cy = stemEnd[1] - 0.30;
      // ring hangs in a vertical plane facing outward
      const seg = 40, rv = 12, R = 0.30, r = 0.052;
      const base = m.vcount;
      for (let u = 0; u <= seg; u++) {
        const au = (u / seg) * Math.PI * 2;
        for (let v = 0; v <= rv; v++) {
          const av = (v / rv) * Math.PI * 2;
          const rr = R + r * Math.cos(av);
          // ring plane perpendicular to 'facing'
          const px = Math.cos(au) * rr;
          const py = Math.sin(au) * rr;
          const pz = r * Math.sin(av);
          const wx = axis === 'z' ? cx + pz * facing : cx + px;
          const wy = cy + py;
          const wz = axis === 'z' ? cz + px : cz + pz * facing;
          const nx = axis === 'z' ? pz * facing : px / rr;
          const nz = axis === 'z' ? px / rr : pz * facing;
          m.vert([wx, wy, wz], V3.norm([nx, py / rr, nz]), [au * R, av * r], 1, MAT.RING_RED);
        }
      }
      for (let u = 0; u < seg; u++) for (let v = 0; v < rv; v++) {
        const i0 = base + u * (rv + 1) + v;
        m.idx.push(i0, i0 + 1, i0 + rv + 2, i0, i0 + rv + 2, i0 + rv + 1);
      }
    }
  }
}

// ---------------------------------------------------------------
//  wall clock, stopped
// ---------------------------------------------------------------
function stoppedClock(m, x, y, z, nrm, hour, minute) {
  const R = 0.30;
  const n = V3.norm(nrm);
  // face sits just off the wall
  const c = [x + n[0] * 0.035, y + n[1] * 0.035, z + n[2] * 0.035];

  // rim
  const seg = 36;
  const base = m.vcount;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    // build an orthonormal basis around the wall normal
    const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const t1 = V3.norm(V3.cross(up, n));
    const t2 = V3.cross(n, t1);
    const p = [
      c[0] + (t1[0] * ca + t2[0] * sa) * R,
      c[1] + (t1[1] * ca + t2[1] * sa) * R,
      c[2] + (t1[2] * ca + t2[2] * sa) * R,
    ];
    m.vert(p, n, [ca * R, sa * R], 1, MAT.DARK_METAL);
  }
  for (let i = 0; i < seg; i++) m.idx.push(base + i, base + i + 1, base + seg + 1);

  // face disc
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = V3.norm(V3.cross(up, n));
  const t2 = V3.cross(n, t1);
  const fc = m.vcount;
  m.vert(c, n, [0, 0], 1, MAT.CLOCK);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    m.vert([
      c[0] + (t1[0] * ca + t2[0] * sa) * R * 0.94,
      c[1] + (t1[1] * ca + t2[1] * sa) * R * 0.94,
      c[2] + (t1[2] * ca + t2[2] * sa) * R * 0.94,
    ], n, [ca, sa], 1, MAT.CLOCK);
  }
  for (let i = 0; i < seg; i++) m.idx.push(fc, fc + 1 + i, fc + 2 + i);

  // hands - stuck at an odd time
  const hand = (angle, len, w) => {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const tip = [
      c[0] + (t1[0] * ca + t2[0] * sa) * len,
      c[1] + (t1[1] * ca + t2[1] * sa) * len,
      c[2] + (t1[2] * ca + t2[2] * sa) * len,
    ];
    const perp = [t1[0] * -sa + t2[0] * ca, t1[1] * -sa + t2[1] * ca, t1[2] * -sa + t2[2] * ca];
    const o0 = [c[0] + perp[0] * w + n[0] * 0.006, c[1] + perp[1] * w + n[1] * 0.006, c[2] + perp[2] * w + n[2] * 0.006];
    const o1 = [c[0] - perp[0] * w + n[0] * 0.006, c[1] - perp[1] * w + n[1] * 0.006, c[2] - perp[2] * w + n[2] * 0.006];
    const t0 = [tip[0] + perp[0] * w * 0.5, tip[1] + perp[1] * w * 0.5, tip[2] + perp[2] * w * 0.5];
    const t2b = [tip[0] - perp[0] * w * 0.5, tip[1] - perp[1] * w * 0.5, tip[2] - perp[2] * w * 0.5];
    m.quad(o0, t0, t2b, o1, n, 1, MAT.DARK_METAL);
  };
  // 12h and 60m, both measured from 12 o'clock, clockwise
  hand(Math.PI / 2 - (hour % 12) / 12 * Math.PI * 2, R * 0.52, 0.016);
  hand(Math.PI / 2 - minute / 60 * Math.PI * 2, R * 0.78, 0.011);
}

// ---------------------------------------------------------------
//  crooked warning sign
// ---------------------------------------------------------------
function crookedSign(m, x, y, z, nrm, tilt, w, h) {
  const n = V3.norm(nrm);
  const up = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = V3.norm(V3.cross(up, n));
  const t2 = V3.cross(n, t1);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  // tilt the sign in its own plane
  const rot = (u, v) => [t1[0] * (u * ct - v * st), t1[1] * (u * ct - v * st), t1[2] * (u * ct - v * st)]
    .map((c, i) => c + t2[i] * (u * st + v * ct));

  const at = (u, v) => {
    const r = rot(u, v);
    return [x + r[0] + n[0] * 0.02, y + r[1] + n[1] * 0.02, z + r[2] + n[2] * 0.02];
  };
  m.quad(at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2), n, 1, MAT.PLASTIC);

  // mounting posts
  for (const u of [-w * 0.34, w * 0.34]) {
    const p = at(u, 0);
    m.tube([[x + n[0] * 0.02 + rot(u, 0)[0] * 0, y, z], [p[0], p[1], p[2]]], 0.014, MAT.DARK_METAL, 6, 1, false);
  }
}

// ---------------------------------------------------------------
//  scatter
// ---------------------------------------------------------------
export function addBackroomsProps(m, lights, H) {
  // One fixed seed: the layout is stable across reloads and screenshots.
  const rand = mulberry32(0x8badf00d);

  // ---- locker banks along the green tile walls, offset from the columns ----
  // Columns sit at x = +-8.5, so the banks go between them and the wall.
  lockerBank(m, rand, -10.55, -14.6, 6, -1, Math.PI / 2);
  lockerBank(m, rand, -10.55, 4.9, 7, -1, Math.PI / 2);
  lockerBank(m, rand, 10.55, -3.2, 5, 1, -Math.PI / 2);
  lockerBank(m, rand, 10.55, 15.4, 6, 1, -Math.PI / 2);

  // ---- hook rails where the life rings used to be ----
  hookRail(m, rand, -11.30, 2.35, -18.0, 'z', 5.2, 1);
  hookRail(m, rand, 11.30, 2.35, 8.6, 'z', 4.6, -1);
  hookRail(m, rand, 3.4, 2.35, -22.70, 'x', 4.0, 1);

  // ---- stopped clocks ----
  stoppedClock(m, -11.55, 4.6, -7.4, [1, 0, 0], 7, 23);
  stoppedClock(m, 11.55, 4.6, 12.1, [-1, 0, 0], 11, 48);
  stoppedClock(m, 0.0, 4.9, -22.95, [0, 0, 1], 3, 7);

  // ---- crooked signs ----
  crookedSign(m, -7.9, 2.05, -22.86, [0, 0, 1], 0.22, 0.62, 0.34);
  crookedSign(m, 8.2, 2.05, 22.86, [0, 0, -1], -0.31, 0.58, 0.32);
  crookedSign(m, -11.42, 2.10, 18.4, [1, 0, 0], 0.17, 0.55, 0.30);

  // ---- cold fluorescent replacements: a few of the pendants are now tubes ----
  // Placed high, off-centre, and deliberately not aligned with the existing lamps.
  const tubeZ = [-19.4, -3.1, 9.7, 17.2];
  for (const z of tubeZ) {
    const x = (rand() - 0.5) * 5.2;
    const yTop = H.y + H.vault * (1 - (x / H.x1) * (x / H.x1));
    const y = yTop - 1.55;
    const len = 1.15 + rand() * 0.35;
    // tube body
    m.cyl(P(x, 0, z), 0.032, y - len * 0.5, y + len * 0.5, MAT.EMIT_COLD, 10, true);
    // end caps
    for (const dy of [-len * 0.5, len * 0.5]) {
      m.cyl(P(x, 0, z), 0.045, y + dy - 0.012, y + dy + 0.012, MAT.DARK_METAL, 10, true);
    }
    // drop wire
    m.cyl(P(x, 0, z), 0.008, y + len * 0.5, yTop - 0.03, MAT.DARK_METAL, 5, false);
    lights.push({ pos: [x, y, z], color: [0.72, 0.95, 0.82], intensity: 13.0, radius: 0.20 });
  }

  // ---- lost property: small clutter on the deck, none of it arranged ----
  const clutter = [
    [-9.6, 1.1, 'bottle'], [8.9, -12.4, 'slipper'], [-3.2, 18.9, 'towel'],
    [6.4, 6.2, 'bottle'], [-10.1, -19.7, 'slipper'], [9.8, 2.6, 'glasses'],
    [2.1, -21.4, 'towel'], [-8.4, 9.3, 'bottle'],
  ];
  for (const [cx, cz, kind] of clutter) {
    const yaw = rand() * Math.PI * 2;
    if (kind === 'bottle') {
      const r = 0.036, hh = 0.21;
      m.cyl(P(cx, 0, cz), r, 0.001, hh, MAT.PLASTIC, 12, true);
      m.cyl(P(cx, 0, cz), r * 0.55, hh, hh + 0.05, MAT.PLASTIC, 10, true);
    } else if (kind === 'slipper') {
      m.box(P(cx - 0.055, 0.0, cz - 0.12), P(cx + 0.055, 0.045, cz + 0.13), MAT.PLASTIC, 1, {});
      m.box(P(cx - 0.045, 0.045, cz - 0.02), P(cx + 0.045, 0.058, cz + 0.11), MAT.PLASTIC, 1, {});
    } else if (kind === 'towel') {
      // crumpled: three overlapping slabs at slight angles
      for (let k = 0; k < 3; k++) {
        const ox = (rand() - 0.5) * 0.16, oz = (rand() - 0.5) * 0.16;
        const yy = 0.004 + k * 0.022;
        m.box(P(cx - 0.20 + ox, yy, cz - 0.26 + oz), P(cx + 0.20 + ox, yy + 0.020, cz + 0.26 + oz), MAT.TOWEL, 1, {});
      }
    } else if (kind === 'glasses') {
      m.cyl(P(cx, 0, cz), 0.055, 0.001, 0.006, MAT.GLASS, 14, true);
      m.cyl(P(cx + 0.115, 0, cz), 0.055, 0.001, 0.006, MAT.GLASS, 14, true);
      m.tube([P(cx + 0.05, 0.004, cz), P(cx + 0.065, 0.006, cz)], 0.004, MAT.GLASS, 5, 1, false);
    }
  }
}
