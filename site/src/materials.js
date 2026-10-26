// material table -> uniform arrays for the G-buffer shader
import { MAT } from './geom.js';

const M = (albedo, rough, opts = {}) => ({
  albedo, rough,
  metal: opts.metal ?? 0,
  tileW: opts.tileW ?? 0.15,
  tileH: opts.tileH ?? 0.15,
  grout: opts.grout ?? 0.0032,
  nStr: opts.nStr ?? 1.0,
  sss: opts.sss ?? 0,
  pattern: opts.pattern ?? 1,
  variation: opts.variation ?? 0,
  tint: opts.tint ?? [0.5, 0.5, 0.5],
  emitStr: opts.emitStr ?? 0,
});

export const MATERIALS = [];

// ---------- ceramic ----------
MATERIALS[MAT.WHITE_TILE] = M([0.870, 0.845, 0.760], 0.075, {
  pattern: 1, tileW: 0.15, tileH: 0.15, grout: 0.0030,
  tint: [0.50, 0.465, 0.380], nStr: 0.85, variation: 0.35,
});
MATERIALS[MAT.GREEN_TILE] = M([0.235, 0.400, 0.280], 0.062, {
  pattern: 2, tileW: 0.15, tileH: 0.15, grout: 0.0034,
  tint: [0.150, 0.255, 0.165], variation: 0.80, nStr: 0.95,
});
MATERIALS[MAT.POOL_TILE] = M([0.816, 0.813, 0.768], 0.092, {
  pattern: 8, tileW: 0.048, tileH: 0.048, grout: 0.0020,
  tint: [0.384, 0.396, 0.354], variation: 0.45, nStr: 0.9,
});
MATERIALS[MAT.DARK_TILE] = M([0.058, 0.140, 0.225], 0.070, {
  pattern: 11, tileW: 0.048, tileH: 0.048, grout: 0.0020,
  tint: [0.055, 0.120, 0.235], variation: 0.45, nStr: 0.9,
});
MATERIALS[MAT.PORCELAIN] = M([0.915, 0.890, 0.805], 0.055, { pattern: 5, nStr: 0.6 });

// ---------- metals ----------
MATERIALS[MAT.METAL] = M([0.920, 0.928, 0.940], 0.085, { pattern: 4, metal: 1.0, nStr: 0.45 });
MATERIALS[MAT.DARK_METAL] = M([0.085, 0.090, 0.098], 0.30, { pattern: 4, metal: 1.0, nStr: 0.6 });

// ---------- architectural surfaces ----------
MATERIALS[MAT.PAINT] = M([0.820, 0.795, 0.715], 0.46, { pattern: 9, nStr: 0.5 });
MATERIALS[MAT.CONCRETE] = M([0.735, 0.733, 0.715], 0.74, { pattern: 3, nStr: 0.8 });
MATERIALS[MAT.TERRAZZO] = M([0.700, 0.672, 0.585], 0.26, { pattern: 7, tint: [0.30, 0.28, 0.22], nStr: 0.7 });

// ---------- light sources ----------
MATERIALS[MAT.EMIT_SKY] = M([1.0, 1.0, 1.0], 0.30, { pattern: 10, tint: [1.0, 0.98, 0.94], emitStr: 8.0 });
MATERIALS[MAT.EMIT_WARM] = M([1.0, 0.94, 0.86], 0.30, { pattern: 10, tint: [1.0, 0.84, 0.62], emitStr: 7.0 });
MATERIALS[MAT.SKY] = M([1.0, 1.0, 1.0], 0.20, { pattern: 13, tint: [1.0, 1.0, 1.0], emitStr: 7.4 });
MATERIALS[MAT.GLASS] = M([0.9, 0.95, 1.0], 0.03, { pattern: 12 });

// ---------- props ----------
MATERIALS[MAT.RING_RED] = M([0.700, 0.082, 0.058], 0.42, { pattern: 6, nStr: 0.9, sss: 0.10 });
MATERIALS[MAT.TOY_YELLOW] = M([0.950, 0.700, 0.035], 0.30, { pattern: 6, nStr: 0.8 });
MATERIALS[MAT.TOY_BLUE] = M([0.032, 0.135, 0.760], 0.30, { pattern: 6, nStr: 0.8 });
MATERIALS[MAT.TOY_ORANGE] = M([0.960, 0.310, 0.020], 0.30, { pattern: 6, nStr: 0.8 });
MATERIALS[MAT.TOY_WHITE] = M([0.880, 0.878, 0.855], 0.34, { pattern: 6, nStr: 0.8 });
MATERIALS[MAT.SLIDE] = M([0.055, 0.300, 0.395], 0.11, { pattern: 6, nStr: 0.55, sss: 0.3 });
MATERIALS[MAT.TOWEL] = M([0.82, 0.81, 0.78], 0.90, { pattern: 15 });
MATERIALS[MAT.WOOD] = M([0.42, 0.28, 0.17], 0.42, { pattern: 16 });

// ---------- backrooms props ----------
// Lockers: dull painted steel, slightly chalky, not mirror-finish chrome.
MATERIALS[MAT.STEEL] = M([0.330, 0.352, 0.360], 0.42, { pattern: 4, metal: 1.0, nStr: 0.75 });
// Cold fluorescent: the signature backrooms light. Slightly green-white, harsh.
MATERIALS[MAT.EMIT_COLD] = M([0.92, 0.98, 0.94], 0.25, { pattern: 10, tint: [0.82, 0.96, 0.88], emitStr: 9.0 });
// Clock face: aged enamel, off-white, matte.
MATERIALS[MAT.CLOCK] = M([0.845, 0.842, 0.815], 0.38, { pattern: 5, nStr: 0.4 });
// Lost-property plastic: scuffed, dull, no strong sheen.
MATERIALS[MAT.PLASTIC] = M([0.520, 0.515, 0.495], 0.62, { pattern: 9, nStr: 0.55 });

const N = 32;
export function packMaterials() {
  const A = new Float32Array(N * 4), B = new Float32Array(N * 4), C = new Float32Array(N * 4), D = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const m = MATERIALS[i] || MATERIALS[MAT.PAINT];
    A[i * 4] = m.albedo[0]; A[i * 4 + 1] = m.albedo[1]; A[i * 4 + 2] = m.albedo[2]; A[i * 4 + 3] = m.rough;
    B[i * 4] = m.metal; B[i * 4 + 1] = m.tileW; B[i * 4 + 2] = m.tileH; B[i * 4 + 3] = m.grout;
    C[i * 4] = m.nStr; C[i * 4 + 1] = m.sss; C[i * 4 + 2] = m.pattern; C[i * 4 + 3] = m.variation;
    D[i * 4] = m.tint[0]; D[i * 4 + 1] = m.tint[1]; D[i * 4 + 2] = m.tint[2]; D[i * 4 + 3] = m.emitStr;
  }
  return { A, B, C, D };
}
