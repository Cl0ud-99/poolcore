#version 300 es
precision highp float;
precision highp int;

in vec3 vPos;
in vec3 vNrm;
in vec2 vUV;
in vec2 vAO;

uniform vec4 uMatA[32];  // albedo.rgb, roughness
uniform vec4 uMatB[32];  // metal, tileW, tileH, grout
uniform vec4 uMatC[32];  // normalStrength, sss, pattern, variation
uniform vec4 uMatD[32];  // tint.rgb, emitStr
uniform vec3 uCamPos;
uniform float uTime;
uniform float uWaterY;

layout(location=0) out vec4 oAlbedo;   // rgb, ao
layout(location=1) out vec4 oNormal;   // oct(n), sss
layout(location=2) out vec4 oMR;       // rough, metal, curv, wet
layout(location=3) out vec4 oEmit;     // rgb, strength

struct TileInfo { vec2 cell; vec2 f; float e; float id; float id2; };

// how much procedural detail at 'freq' survives given the world-space pixel
// footprint fp.  Nyquist-correct: detail dies once a cycle drops below ~1 px.
float footAA(float freq, float fp) { return smoothstep(0.85, 0.30, fp * freq); }

TileInfo tileAt(vec2 uv, float tw, float th, float seed) {
  TileInfo t;
  vec2 q = uv / vec2(tw, th);
  vec2 c = floor(q);
  t.cell = c;
  t.f = q - c;
  t.e = min(min(t.f.x, 1.0 - t.f.x) * tw, min(t.f.y, 1.0 - t.f.y) * th);
  ivec2 ic = ivec2(c) + ivec2(65536);
  t.id  = hash1(uvec3(uvec2(ic), uint(seed)));
  t.id2 = hash1(uvec3(uvec2(ic) + uvec2(37u, 71u), uint(seed) + 7u));
  return t;
}

float pixelsPerTile(vec2 uv, float tw, float th) {
  vec2 fw = fwidth(uv);
  return min(tw / max(fw.x, 1e-6), th / max(fw.y, 1e-6));
}

// grout + bevel, filtered so a sub-pixel grout line integrates instead of aliasing
void tileShade(vec2 uv, float tw, float th, float groutW, float fp,
               out TileInfo T, out float mask, out vec2 nxy) {
  T = tileAt(uv, tw, th, 11.0);
  float gw = max(groutW * 0.5, 0.0005);
  float bevel = clamp(gw * 0.95, 0.0005, 0.0032);
  // widen the transition to roughly one pixel so thin lines average out
  float edge = max(bevel, fp * 0.62);
  mask = smoothstep(gw - edge, gw + edge, T.e);

  float b = 1.0 - smoothstep(0.0, bevel * 2.4, T.e);
  float ex = min(T.f.x, 1.0 - T.f.x) * tw;
  float ey = min(T.f.y, 1.0 - T.f.y) * th;
  vec2 dEdge = (ex < ey) ? vec2(-sign(T.f.x - 0.5), 0.0) : vec2(0.0, -sign(T.f.y - 0.5));
  float nFade = clamp(bevel / max(fp, 1e-6), 0.0, 1.0);
  nxy = -dEdge * b * 0.52 * nFade;

  // shallow pillow: the glaze reads as a soft convex lens in reflections
  vec2 df = T.f - 0.5;
  vec2 dome = vec2(cos(df.x * PI) * sin(df.y * PI), sin(df.x * PI) * cos(df.y * PI));
  nxy += -dome * 0.030 * nFade;
}

vec3 tbnNormal(vec3 N, vec3 T, vec3 B, vec3 nt) {
  return normalize(T * nt.x + B * nt.y + N * nt.z);
}

void main() {
  int mi = int(vAO.y + 0.5);
  vec4 mA = uMatA[mi];
  vec4 mB = uMatB[mi];
  vec4 mC = uMatC[mi];
  vec4 mD = uMatD[mi];
  int pattern = int(mC.z + 0.5);
  float nStr = mC.x;
  float variation = mC.w;

  vec3 N = normalize(vNrm);
  vec3 V = normalize(uCamPos - vPos);

  vec3 dp1 = dFdx(vPos), dp2 = dFdy(vPos);
  vec2 du1 = dFdx(vUV), du2 = dFdy(vUV);
  vec3 T = normalize(dp1 * du2.y - dp2 * du1.y + N * 1e-6);
  vec3 B = normalize(cross(N, T));
  T = normalize(cross(B, N));

  // world-space size of one pixel -> the master anti-aliasing key
  float fp = max(length(fwidth(vPos)), 1e-5);

  vec3 albedo = mA.rgb;
  float rough = mA.a;
  float metal = mB.x;
  float ao = vAO.x;
  float sss = mC.y;
  float curv = 0.0;
  float wet = 0.0;
  vec3 emit = vec3(0.0);
  float emitStr = 0.0;
  vec2 nxy = vec2(0.0);

  // ======================= ceramic tiles =======================
  if (pattern == 1 || pattern == 2 || pattern == 8 || pattern == 11) {
    float tw = mB.y, th = mB.z, gw = mB.w;
    float pxTile = pixelsPerTile(vUV, tw, th);
    float aaTile = smoothstep(0.55, 1.70, pxTile);
    TileInfo T0; float mask; vec2 tn;
    tileShade(vUV, tw, th, gw, fp, T0, mask, tn);

    vec3 tileCol = mA.rgb;
    float tileRough = mA.a;

    if (pattern == 2) {
      tileCol = mix(mA.rgb, mD.rgb, 0.22 + 0.50 * T0.id * variation);
      tileCol *= 0.88 + 0.24 * T0.id2;
      tileRough += (T0.id2 - 0.5) * 0.04;
    } else if (pattern == 8) {
      tileCol = mix(mA.rgb, mD.rgb, T0.id * 0.42 * variation);
      tileCol *= 0.95 + 0.10 * T0.id2;
      tileRough += (T0.id - 0.5) * 0.04;
    } else if (pattern == 11) {
      tileCol = mix(mA.rgb, mD.rgb, T0.id * 0.30 * variation);
      tileCol *= 0.94 + 0.12 * T0.id2;
    } else {
      // clean glazed field tile: a whisper of per-tile drift, nothing more
      tileCol *= 1.0 + (T0.id - 0.5) * 0.028 * (0.4 + variation);
      tileCol *= 1.0 + (T0.id2 - 0.5) * 0.016;
      float pool = smoothstep(0.0, tw * 0.5, T0.e);
      tileCol *= mix(0.990, 1.006, pool);
      tileRough += (T0.id - 0.5) * 0.020;
    }

    // ---- grout ----
    float dirt = fbmAA(vPos * 6.0, 2, footAA(6.0, fp)) * footAA(6.0, fp);
    vec3 groutCol = mD.rgb * (0.86 + 0.26 * dirt);
    float groutRough = 0.90;

    vec3 detailed = mix(groutCol, tileCol, mask);
    // area-average for the distance LOD so the wall never shimmers
    vec3 avgCol = mix(groutCol, tileCol, 0.90);
    albedo = mix(avgCol, detailed, aaTile);
    rough  = mix(0.60, mix(groutRough, tileRough, mask), aaTile);
    metal  = metal * mask * aaTile;
    ao    *= mix(1.0, mix(0.72, 1.0, mask), aaTile);

    // ---- normal ----
    nxy = tn * nStr;
    // glaze orange-peel: sub-millimetre, fades out immediately
    float opAmp = footAA(140.0, fp) * 0.020 * nStr;
    if (opAmp > 0.0005) {
      nxy += vec2(vnoise(vPos * 140.0) - 0.5, vnoise(vPos * 140.0 + 13.7) - 0.5) * opAmp;
    }
    // waviness of the setting bed
    float wvAmp = footAA(2.4, fp) * 0.030 * nStr;
    if (wvAmp > 0.0005) {
      nxy += vec2(fbm(vPos * 2.4 + 1.0, 2) - 0.5, fbm(vPos * 2.4 + 41.0, 2) - 0.5) * wvAmp;
    }
    curv = mask;

    // ---- expansion joints: 1.2 m panel grid (8 tiles) ----
    if (pattern == 1 || pattern == 2) {
      vec2 gj = abs(fract(vUV / 1.2 + 0.5) - 0.5) * 1.2;
      float jd = min(gj.x, gj.y);
      float jw = 0.0055;
      // widen the transition by exactly the footprint, then fade the whole
      // joint out once it is thinner than a pixel and cannot be resolved
      float jEdge = max(0.0018, fp * 0.60);
      float joint = 1.0 - smoothstep(jw - jEdge, jw + jEdge, jd);
      joint *= smoothstep(0.075, 0.030, fp);
      albedo = mix(albedo, vec3(0.52, 0.52, 0.50), joint * 0.55);
      rough = mix(rough, 0.50, joint);
      ao *= mix(1.0, 0.80, joint);
      vec2 jn = (gj.x < gj.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      nxy += jn * joint * 0.30;
    }

    // ---- very light weathering ----
    float streak = smoothstep(0.72, 1.0, fbm(vec3(vPos.x * 5.0, vPos.y * 0.42, vPos.z * 5.0) + 7.0, 2)) * footAA(5.0, fp);
    albedo *= 1.0 - streak * 0.018;
    float grime = smoothstep(0.66, 0.98, fbm(vPos * 0.8 + 5.0, 2)) * footAA(0.8, fp);
    albedo *= 1.0 - grime * 0.016 * (1.0 - mask * 0.5);

  // ======================= plaster / concrete =======================
  } else if (pattern == 3) {
    float st = fbmAA(vPos * 1.4, 3, footAA(1.4, fp)) * footAA(1.4, fp);
    float fine = fbmAA(vPos * 9.0, 2, footAA(9.0, fp)) * footAA(9.0, fp);
    albedo *= (0.93 + 0.10 * st) * (0.975 + 0.05 * fine);
    rough = clamp(mA.a + 0.10 * (st - 0.5), 0.05, 1.0);
    nxy = (vec2(fine, fbm(vPos * 9.0 + 11.0, 2)) - 0.5) * 0.30 * nStr * footAA(9.0, fp);

  // ======================= brushed metal =======================
  } else if (pattern == 4) {
    float brushed = vnoise(vec3(vPos.x * 3.0, vPos.y * 240.0, vPos.z * 3.0)) * footAA(240.0, fp);
    albedo *= (0.96 + 0.05 * brushed);
    rough = clamp(mA.a + (brushed - 0.5) * 0.06, 0.02, 1.0);
    nxy = vec2(0.0, (brushed - 0.5) * 0.02 * nStr);

  // ======================= porcelain / glazed trim =======================
  } else if (pattern == 5) {
    float mott = fbmAA(vPos * 5.0, 2, footAA(5.0, fp)) * footAA(5.0, fp);
    albedo *= (0.99 + 0.02 * mott);
    rough = clamp(mA.a + (mott - 0.5) * 0.03, 0.02, 1.0);
    float mo = footAA(150.0, fp) * 0.016 * nStr;
    if (mo > 0.0005) nxy = vec2(vnoise(vPos * 150.0) - 0.5, vnoise(vPos * 150.0 + 9.0) - 0.5) * mo;

  // ======================= rubber / inflatable =======================
  } else if (pattern == 6) {
    float w = fbmAA(vPos * 2.6, 2, footAA(2.6, fp)) * footAA(2.6, fp);
    albedo *= (0.975 + 0.05 * w);
    rough = clamp(mA.a + 0.03 * (w - 0.5), 0.04, 1.0);
    // mould-release dimples: broad, low frequency, never a noise field
    float g1 = footAA(4.5, fp) * 0.011 * nStr;
    if (g1 > 0.0005) nxy += vec2(vnoise(vPos * 4.5) - 0.5, vnoise(vPos * 4.5 + 5.0) - 0.5) * g1;
    // No parting line here. Both previous versions (arc-length sin and world-space
    // sin) painted one wide dark band per tube cross-section, which read as a
    // stack of striped jelly rings rather than moulded rubber. Dimples plus the
    // low-frequency mottling above are all a rotomoulded buoy actually shows.

  // ======================= terrazzo =======================
  } else if (pattern == 7) {
    vec2 t = vUV / 0.62;
    vec2 c = floor(t);
    float h = hash1(uvec3(uvec2(ivec2(c) + ivec2(65536)), 7u));
    float slAA = smoothstep(0.004, 0.020, fp);
    albedo *= mix(1.0, 0.975 + 0.05 * h, slAA);
    float chips = smoothstep(0.60, 0.80, fbm(vPos * 22.0, 2)) * footAA(22.0, fp);
    float chips2 = smoothstep(0.66, 0.86, fbm(vPos * 52.0 + 9.0, 2)) * footAA(52.0, fp);
    albedo = mix(albedo, mD.rgb, chips * 0.45);
    albedo = mix(albedo, mD.rgb * 1.6, chips2 * 0.22);
    rough = clamp(mA.a + (fbm(vPos * 3.0, 2) - 0.5) * 0.12, 0.05, 1.0);
    nxy = (vec2(fbm(vPos * 30.0, 2), fbm(vPos * 30.0 + 3.0, 2)) - 0.5) * 0.05 * nStr * footAA(30.0, fp);

  // ======================= painted =======================
  } else if (pattern == 9) {
    float n = fbmAA(vPos * 4.0, 2, footAA(4.0, fp)) * footAA(4.0, fp);
    albedo *= (0.985 + 0.025 * n);
    rough = clamp(mA.a + (n - 0.5) * 0.04, 0.02, 1.0);
    float po = footAA(120.0, fp) * 0.014 * nStr;
    if (po > 0.0005) nxy = vec2(vnoise(vPos * 120.0) - 0.5, vnoise(vPos * 120.0 + 7.0) - 0.5) * po;

  // ======================= emissive fixture =======================
  } else if (pattern == 10) {
    emit = mA.rgb * mD.rgb;
    emitStr = mD.w;
    albedo = vec3(0.02);
    rough = 0.18;
    metal = 0.0;

  // ======================= sky portal (window / skylight) =======================
  } else if (pattern == 13) {
    vec3 dir = normalize(vPos - vec3(0.0, 2.0, 0.0));
    float hgt = clamp((vPos.y - 2.6) / 7.2, 0.0, 1.0);
    // A real sky through a window is a gradient with a bright horizon band, not
    // a flat white card. Keeping the top of the gradient dark is what stops the
    // openings from clipping to paper white once ACES and bloom get hold of them.
    // Poolcore windows are not blue daylight: they are a blown-out warm white,
    // as if the "outside" is overcast and slightly yellowed. Keeping a faint
    // green-grey at the top stops them reading as flat paper cut-outs.
    vec3 sky = mix(vec3(1.00, 0.985, 0.930), vec3(0.78, 0.80, 0.70), pow(hgt, 0.85));
    sky = mix(sky, vec3(1.0, 0.965, 0.885), pow(1.0 - hgt, 2.0) * 0.80);
    vec3 sd = normalize(vec3(-0.62, 0.34, 0.70));
    float sunAmt = pow(max(dot(dir, sd), 0.0), 6.0);
    sky = mix(sky, vec3(1.0, 0.94, 0.80), sunAmt * 0.70);
    float cl = fbm(vec3(vPos.x * 0.16, vPos.y * 0.55, vPos.z * 0.16), 4);
    cl = smoothstep(0.42, 0.90, cl) * smoothstep(0.05, 0.50, hgt);
    sky = mix(sky, vec3(1.0, 0.995, 0.985), cl * 0.55);
    float gnd = smoothstep(3.4, 1.9, vPos.y);
    sky = mix(sky, vec3(0.62, 0.60, 0.50) * (0.70 + 0.45 * fbm(vec3(vPos.xz * 0.9, 3.0), 3)), gnd * 0.80);
    emit = sky;
    emitStr = mD.w;
    albedo = vec3(0.03);
    rough = 0.09;
    metal = 0.0;

  // ======================= window glass =======================
  } else if (pattern == 12) {
    albedo = vec3(0.012);
    rough = 0.045;
    metal = 0.0;
    nxy = vec2(vnoise(vPos * 90.0) - 0.5, vnoise(vPos * 90.0 + 5.0) - 0.5) * 0.012 * footAA(90.0, fp);

  // ======================= fabric =======================
  } else if (pattern == 15) {
    float weave = sin(vPos.x * 900.0) * sin(vPos.y * 900.0 + vPos.z * 300.0) * footAA(900.0, fp);
    float fz = fbmAA(vPos * 34.0, 2, footAA(34.0, fp)) * footAA(34.0, fp);
    albedo *= (0.95 + 0.06 * fz) * (0.98 + 0.03 * weave);
    rough = clamp(mA.a + (fz - 0.5) * 0.06, 0.3, 1.0);
    nxy = vec2(weave, fbm(vPos * 34.0 + 3.0, 2) - 0.5) * 0.06 * nStr;

  // ======================= wood =======================
  } else if (pattern == 16) {
    vec3 q = vPos * vec3(9.0, 1.2, 9.0);
    float rings = sin(q.y * 26.0 + fbm(q * 0.5, 2) * 8.0) * footAA(26.0, fp);
    albedo *= (0.84 + 0.22 * (rings * 0.5 + 0.5));
    rough = clamp(mA.a + 0.05 * rings, 0.15, 1.0);
    nxy = vec2(0.0, (fbm(vPos * 26.0, 2) - 0.5) * 0.05 * nStr);

  } else {
    nxy = vec2(0.0);
  }

  // ---- large scale surface undulation (setting bed / plaster waves) ----
  float undAmp = footAA(0.45, fp) * 0.012;
  if (undAmp > 0.0004) {
    nxy += vec2(fbm(vPos * 0.45 + 3.0, 2) - 0.5, fbm(vPos * 0.45 + 21.0, 2) - 0.5) * undAmp;
  }

  vec3 nW = tbnNormal(N, T, B, normalize(vec3(nxy, 1.0)));

  // ---- waterline: mineral stain, wet darkening ----
  float dy = vPos.y - uWaterY;
  if (dy > -0.50 && dy < 0.50) {
    float near = smoothstep(0.18, 0.0, abs(dy));
    float stain = near * (0.45 + 0.55 * fbm(vPos * 8.0, 2));
    albedo *= 1.0 - stain * 0.22;
    rough = mix(rough, 0.48, near * 0.40);
    float scum = smoothstep(0.012, 0.0, abs(dy - 0.008)) * 0.32;
    albedo = mix(albedo, vec3(0.30, 0.33, 0.29), scum);
  }
  if (dy < 0.0) {
    float damp = smoothstep(0.0, -0.10, dy);
    albedo *= mix(1.0, 0.82, damp);
    rough = mix(rough, rough * 0.68, damp);
    wet = damp;
  }

  oAlbedo = vec4(max(albedo, vec3(0.0)), clamp(ao, 0.0, 1.0));
  oNormal = vec4(nW * 0.5 + 0.5, sss);
  oMR = vec4(clamp(rough, 0.02, 1.0), clamp(metal, 0.0, 1.0), curv, wet);
  oEmit = vec4(emit, emitStr);
}
