#version 300 es
precision highp float;

in vec2 vUV;
out vec4 oColor;

uniform sampler2D uOpaque;
uniform sampler2D uDepth;
uniform samplerCube uEnv;
uniform sampler2D uShadowMap;
uniform mat4 uShadowVP;
uniform mat4 uVP;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec2 uRes;
uniform float uTime;
uniform float uWaterY;
uniform float uEnvMips;
uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform vec3 uPoolMin;
uniform vec3 uPoolMax;
uniform float uSSROn;
uniform float uCaustics;
uniform int uLightCount;
uniform vec4 uLightPos[64];
uniform vec4 uLightCol[64];

vec3 worldAt(vec2 uv, float d) {
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 w = uInvVP * c; w /= w.w;
  return w.xyz;
}

// ---------------------------------------------------------------
//  wave field: directional gerstner-ish sum + two fbm layers
// ---------------------------------------------------------------
vec3 waveNormal(vec2 p, float t, float dist, out float crest, out float foam, out vec3 Nlow) {
  vec2 grad = vec2(0.0);
  vec2 gradLow = vec2(0.0);
  float h = 0.0;
  // Fine chop is far below a pixel past ~15 m and only aliases there, so it is
  // faded by view distance. Without this the mirror direction jitters per pixel
  // and the reflection breaks into the stair-stepped blocks seen in the crops.
  float f1 = 1.0 / (1.0 + dist * 0.018);
  float f2 = 1.0 / (1.0 + dist * 0.070);
  // long swell
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float ang = 0.55 + fi * 2.39996;
    vec2 d = vec2(cos(ang), sin(ang));
    float k = 0.75 * pow(1.62, fi);
    float w = sqrt(9.81 * k);
    float amp = 0.0330 / (1.0 + fi * 1.05);
    float ph = dot(d, p) * k + t * w * 0.55 + fi * 1.7;
    grad += d * (amp * k * cos(ph));
    h += amp * sin(ph);
  }
  // Low-frequency part only. Refraction must be displaced by the swell, never
  // by the chop: chop is far below a pixel and turns the underwater image into
  // the blocky, tearing mess that showed up in the close-up crops.
  gradLow = grad;
  // mid ripple: slowly drifting fbm
  float e = 0.015;
  vec2 q = p * 1.9 + vec2(t * 0.055, -t * 0.041);
  float n0 = fbm(vec3(q, t * 0.10), 3);
  float nx = fbm(vec3(q + vec2(e, 0.0), t * 0.10), 3);
  float nz = fbm(vec3(q + vec2(0.0, e), t * 0.10), 3);
  grad += vec2(nx - n0, nz - n0) / e * 0.0300 * f1;
  h += (n0 - 0.5) * 0.010;
  // fine chop: two counter-drifting layers
  float e2 = 0.008;
  vec2 q2 = p * 5.5 + vec2(-t * 0.085, t * 0.072);
  float m0 = fbm(vec3(q2, t * 0.26 + 7.0), 2);
  float mx = fbm(vec3(q2 + vec2(e2, 0.0), t * 0.26 + 7.0), 2);
  float mz = fbm(vec3(q2 + vec2(0.0, e2), t * 0.26 + 7.0), 2);
  grad += vec2(mx - m0, mz - m0) / e2 * 0.0165 * f1;

  float e3 = 0.005;
  vec2 q3 = p * 12.0 + vec2(t * 0.12, -t * 0.10);
  float k0 = vnoise(vec3(q3, t * 0.5 + 3.0));
  float kx = vnoise(vec3(q3 + vec2(e3, 0.0), t * 0.5 + 3.0));
  float kz = vnoise(vec3(q3 + vec2(0.0, e3), t * 0.5 + 3.0));
  grad += vec2(kx - k0, kz - k0) / e3 * 0.0062 * f2;

  crest = smoothstep(0.004, 0.016, h);
  foam = smoothstep(0.012, 0.024, h);
  Nlow = normalize(vec3(-gradLow.x, 1.0, -gradLow.y));
  return normalize(vec3(-grad.x, 1.0, -grad.y));
}

// ---------------------------------------------------------------
//  caustics: thin bright network on the pool floor
// ---------------------------------------------------------------
float caustics(vec2 p, float t) {
  // A pool floor lit through moving water is a wandering, broken net, never a
  // regular set of diagonal bands. Warping the sample position with fbm before
  // the interference sum is what turns the sine pattern into a net.
  vec2 w = vec2(fbm(vec3(p * 1.35, t * 0.20), 2),
                fbm(vec3(p * 1.35 + 31.7, t * 0.20), 2)) - 0.5;
  vec2 q = (p + w * 0.62) * 3.10;
  float v = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float a = fi * 1.2566 + 0.4;
    vec2 d = vec2(cos(a), sin(a));
    float k = 1.05 + fi * 0.62;
    v += sin(dot(q, d) * k + t * (0.85 + fi * 0.31) + fi * 2.3);
  }
  float f = abs(v) / 5.0;
  float c = smoothstep(0.42, 0.02, f);
  // sharpen into filaments: a pool floor net is thin and wiry, never blobby
  c = pow(c, 3.4);
  // secondary finer layer, also warped
  vec2 q2 = (p + w * 0.35) * 5.2;
  float v2 = sin(dot(q2, vec2(0.8, -0.6)) * 1.0 + t * 1.4) * sin(dot(q2, vec2(-0.5, 0.86)) * 0.92 - t * 1.1);
  c += smoothstep(0.88, 1.0, v2) * 0.26;
  return c;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float shadowLookup(vec3 P, vec3 N) {
  vec4 lp = uShadowVP * vec4(P + N * 0.02, 1.0);
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float bias = 0.0015;
  float sum = 0.0;
  vec2 ts = 1.0 / vec2(textureSize(uShadowMap, 0));
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float d = texture(uShadowMap, p.xy + vec2(float(x), float(y)) * ts * 1.8).r;
      sum += (p.z - bias <= d) ? 1.0 : 0.0;
    }
  }
  return sum / 9.0;
}

vec3 ssr(vec3 P, vec3 R, out float hitAmount) {
  hitAmount = 0.0;
  float maxDist = 40.0;
  float t = 0.05;
  vec3 prevP = P;
  // 28 steps instead of 48. The reflection is sampled through an 8-tap cone and a
  // blurred env cube, so the finer march resolution was discarded immediately.
  for (int i = 0; i < 28; i++) {
    t += max(0.06, t * 0.068);
    if (t > maxDist) break;
    vec3 Q = P + R * t;
    vec4 cp = uVP * vec4(Q, 1.0);
    if (cp.w <= 0.0) break;
    vec2 uv = cp.xy / cp.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float d = texture(uDepth, uv).r;
    if (d >= 0.99999) { prevP = Q; continue; }
    vec3 sceneP = worldAt(uv, d);
    if (length(sceneP - uCamPos) < length(Q - uCamPos)) {
      vec3 A = prevP, B = Q;
      for (int j = 0; j < 7; j++) {
        vec3 M = (A + B) * 0.5;
        vec4 c2 = uVP * vec4(M, 1.0);
        vec2 u2 = c2.xy / c2.w * 0.5 + 0.5;
        float d2 = texture(uDepth, u2).r;
        vec3 s2 = worldAt(u2, d2);
        if (length(s2 - uCamPos) < length(M - uCamPos)) B = M; else A = M;
      }
      vec4 c3 = uVP * vec4(B, 1.0);
      vec2 u3 = c3.xy / c3.w * 0.5 + 0.5;
      float edge = smoothstep(0.0, 0.11, min(min(u3.x, 1.0 - u3.x), min(u3.y, 1.0 - u3.y)));
      hitAmount = edge * (1.0 - smoothstep(maxDist * 0.6, maxDist, t));
      // The water surface is never optically flat, so a single mirror tap reads
      // as a razor-sharp, blocky copy of the wall. Four taps spread along the
      // reflected ray smear it into something that looks like water.
      float far = clamp(t / maxDist, 0.0, 1.0);
      float spread = 0.0030 + 0.0140 * far * far;
      vec3 acc = vec3(0.0);
      float ws = 0.0;
      for (int j = 0; j < 8; j++) {
        float fj = float(j);
        float a = fj * 2.39996 + 1.1;
        float rr = sqrt((fj + 0.5) / 8.0) * spread;
        vec2 o = vec2(cos(a), sin(a)) * rr;
        float wgt = 1.0 - 0.55 * (fj / 8.0);
        acc += texture(uOpaque, u3 + o).rgb * wgt;
        ws += wgt;
      }
      acc /= ws;
      // a window reflected in rippled water is a hot streak, not a flat white
      // slab; compressing the top of the range is what stops the splats.
      acc = acc / (1.0 + max(acc.r, max(acc.g, acc.b)) * 0.90);
      return min(acc * 0.95, vec3(1.45));
    }
    prevP = Q;
  }
  return vec3(0.0);
}

void main() {
  float d = texture(uDepth, vUV).r;
  vec3 P = worldAt(vUV, d);
  vec3 rd = normalize(P - uCamPos);

  bool hasWater = rd.y < -1e-4;
  float tHit = 1e9;
  if (hasWater) tHit = (uWaterY - uCamPos.y) / rd.y;
  if (!(tHit > 0.02 && tHit < 400.0)) hasWater = false;
  if (hasWater && d < 0.99999 && distance(uCamPos, P) < tHit) hasWater = false;
  vec3 surfP = uCamPos + rd * tHit;
  if (hasWater) {
    if (surfP.x < uPoolMin.x || surfP.x > uPoolMax.x || surfP.z < uPoolMin.z || surfP.z > uPoolMax.z) hasWater = false;
  }
  if (!hasWater) { oColor = vec4(texture(uOpaque, vUV).rgb, 1.0); return; }

  vec3 V = -rd;
  float waterPath = 0.0;
  if (d < 0.99999) waterPath = max(0.0, distance(uCamPos, P) - tHit);

  float crest, foam;
  vec3 Nlow;
  vec3 N = waveNormal(surfP.xz, uTime, tHit, crest, foam, Nlow);

  float NoV = max(dot(N, V), 0.0);
  // Schlick for water, f0 = 0.02
  // Real water is a near mirror at grazing angles, but this pool is read from a
  // standing eye height: almost every pixel is grazing, so a pure Schlick curve
  // turned the whole basin into a white sheet of reflected skylight. Capping the
  // top of the curve keeps a believable sheen while letting the tiled floor and
  // the body colour show through, which is what the reference photograph reads as.
  float fres = 0.030 + 0.760 * pow(1.0 - NoV, 4.6);

  // ---------------- reflection ----------------
  // Trace the reflection with a smoothed normal. Ripples fine enough to matter
  // for the specular lobe are far smaller than a pixel here; feeding the full
  // normal into a 1-spp screen-space march turns them into visible stair-steps
  // and shatters the reflected image into blocks. The low band keeps the mirror
  // coherent and lets the eight-tap cone do the roughening.
  vec3 Nrefl = normalize(mix(N, Nlow, 0.62));
  vec3 R = reflect(rd, Nrefl);
  if (R.y < 0.012) R = normalize(vec3(R.x, 0.012, R.z));
  float hit = 0.0;
  vec3 refl = ssr(surfP, R, hit) * uSSROn;
  float rlod = clamp(0.06 * uEnvMips + waterPath * 0.045, 0.0, uEnvMips - 1.0);
  float lod = rlod;
  vec3 envR = textureLod(uEnv, R, lod).rgb;
  // two extra rough taps smear the mirror into a broken, watery reflection
  {
    vec3 up2 = abs(R.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T1 = normalize(cross(up2, R));
    vec3 T2 = cross(R, T1);
    // Static in world space on purpose: a per-frame random angle here is white
    // noise that TAA can never converge on, which is where the coloured speckle
    // on the water came from.
    float ja = hash12(surfP.xz * 37.0) * 6.2831853;
    vec2 off = vec2(cos(ja), sin(ja)) * 0.022;
    vec3 R2 = normalize(R + T1 * off.x + T2 * off.y);
    if (R2.y < 0.012) R2 = normalize(vec3(R2.x, 0.012, R2.z));
    float lod2 = clamp(0.20 * uEnvMips, 0.0, uEnvMips - 1.0);
    envR = mix(envR, textureLod(uEnv, R2, lod2).rgb, 0.30);
  }
  // Screen-space hits carry the actual architecture (lane ropes, sconces,
  // window reveals) and are what makes water read as water. The blurred cube is
  // only the fallback for rays that leave the screen; letting it dominate turned
  // the surface into a milky sheet.
  // The cube is baked from a hall full of emissive skylights, so its raw value is
  // several times brighter than the water it is supposed to tint: damp the CUBE.
  // Screen-space hits are already scene radiance and must never be damped with
  // it. Folding both through the same 0.46 factor was what collapsed every
  // reflected wall, sconce and window into a flat black slab on the surface.
  envR *= 0.46;
  envR = mix(envR, envR * vec3(0.60, 0.90, 1.00), 0.70);
  // Hits carry the real architecture (lane ropes, sconces, window reveals) and are
  // the only thing that makes water read as water, so let them lead. The blurred
  // cube is the fallback for rays that leave the screen, not the other way round.
  refl = mix(envR, refl, clamp(hit * 0.88, 0.0, 1.0));
  // A miss must never collapse to zero: a physically dark basin still returns
  // skylight. This floor keeps the grazing-angle reflection readable.
  refl = max(refl, envR * 0.40);

  // ---------------- refraction + absorption ----------------
  vec2 refrUV = vUV + Nlow.xz * (0.034 / (1.0 + waterPath * 0.7)) * clamp(tHit * 0.06, 0.0, 1.0);
  refrUV = clamp(refrUV, vec2(0.0015), vec2(0.9985));
  vec3 refr = texture(uOpaque, refrUV).rgb;
  {
    // The opaque buffer is HDR: the pool floor under a skylight can sit well
    // above 1.0, and a single sharp tap of that reads as a flat white smear.
    // A tiny cross blur plus a range clamp keeps the tile pattern legible.
    vec2 px = 1.6 / uRes;
    vec3 q1 = texture(uOpaque, refrUV + vec2( px.x, 0.0)).rgb;
    vec3 q2 = texture(uOpaque, refrUV + vec2(-px.x, 0.0)).rgb;
    vec3 q3 = texture(uOpaque, refrUV + vec2(0.0,  px.y)).rgb;
    vec3 q4 = texture(uOpaque, refrUV + vec2(0.0, -px.y)).rgb;
    refr = (refr * 2.0 + q1 + q2 + q3 + q4) * 0.1666667;
  }
  refr = min(refr, vec3(2.4));

  // caustics land on the submerged surface
  vec3 floorP = worldAt(refrUV, texture(uDepth, refrUV).r);
  float caus = caustics(floorP.xz, uTime * 0.62) * uCaustics;
  float causFade = exp(-waterPath * 0.13);
  // floorP jumps across a depth discontinuity, which used to print a hard
  // seam wherever a lane rope crossed the pool floor.
  float causAA = smoothstep(0.02, 0.20, waterPath);
  refr *= (1.0 + caus * 0.95 * causFade * causAA);

  // absorption per metre. clean pool water keeps red alive over a few metres,
  // so the white tile under the surface stays readable instead of going cyan.
  // Murky poolcore water, desaturated to roughly 60% chroma.
  // The previous coefficients (0.760, 0.235, 0.430) put green far ahead of both
  // red and blue, so the submerged tile read as vivid emerald. Keeping the same
  // overall luminance but pulling the three channels toward their mean removes
  // the emerald cast while preserving the murky, neglected feel.
  vec3 absorb = exp(-waterPath * vec3(0.575, 0.293, 0.398));
  vec3 scatterCol = mix(uWaterShallow, uWaterDeep, clamp(waterPath / 2.4, 0.0, 1.0));
  vec3 under = refr * absorb + scatterCol * (1.0 - absorb) * 2.30;

  // ---------------- sun specular ----------------
  vec3 L = uSunDir;
  float sunSh = shadowLookup(surfP, N);
  float NoL = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);
  float a = 0.020;
  float D = D_GGX(NoH, a);
  float Vis = V_SmithGGX(NoV, NoL, a);
  vec3 F = F_Schlick(vec3(0.02), VoH);
  vec3 spec = D * Vis * F * NoL * sunSh * uSunColor;

  // ---------------- sconce / lamp glitter: vertical streaks on the water ----------------
  {
    for (int i = 0; i < 64; i++) {
      if (i >= uLightCount) break;
      vec3 lp = uLightPos[i].xyz;
      vec3 lv = lp - surfP;
      float d2 = dot(lv, lv);
      // Range cut before any BRDF work. The glitter term uses win = 1/(d2 + 0.6),
      // so a lamp 30 m away contributes ~1e-3 of a term that is already scaled by
      // a tight specular lobe - invisible. Most of the 48 lights are out of range
      // at any given point on the pool.
      if (d2 > 260.0) continue;
      vec3 l = lv * inversesqrt(max(d2, 1e-6));
      float NoLl = max(dot(N, l), 0.0);
      if (NoLl <= 0.0) continue;
      vec3 H2 = normalize(l + V);
      float NoH2 = max(dot(N, H2), 0.0);
      float VoH2 = max(dot(V, H2), 0.0);
      float a2 = 0.030;
      float D2 = D_GGX(NoH2, a2);
      float Vis2 = V_SmithGGX(NoV, NoLl, a2);
      vec3 F2 = F_Schlick(vec3(0.02), VoH2);
      float win = 1.0 / (d2 + 0.6);
      spec += D2 * Vis2 * F2 * NoLl * uLightCol[i].rgb * uLightCol[i].w * win * 0.55;
    }
  }

  // sparkle: very tight lobe for glints
  float glint = pow(NoH, 2400.0) * sunSh;
  spec += vec3(glint) * uSunColor * 9.0;

  vec3 col = mix(under, refl, fres);
  col += spec;

  // ---------------- edges: meniscus + a touch of foam on the walls ----------------
  float fx = min(surfP.x - uPoolMin.x, uPoolMax.x - surfP.x);
  float fz = min(surfP.z - uPoolMin.z, uPoolMax.z - surfP.z);
  float edge = smoothstep(0.42, 0.0, min(fx, fz));
  float lap = smoothstep(0.55, 1.0, sin(uTime * 1.4 + surfP.x * 3.1 + surfP.z * 2.3) * 0.5 + 0.5);
  col = mix(col, vec3(0.40, 0.47, 0.45) * 0.30, edge * (0.20 + 0.16 * lap));

  // crest foam (very subtle, this is still water)
  col = mix(col, vec3(0.78, 0.82, 0.81), foam * 0.035 * smoothstep(0.4, 0.95, fres));

  oColor = vec4(col, 1.0);
}
