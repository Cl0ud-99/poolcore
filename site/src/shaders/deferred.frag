#version 300 es
precision highp float;
precision highp int;

in vec2 vUV;
out vec4 oColor;

uniform sampler2D uAlbedo;
uniform sampler2D uNormal;
uniform sampler2D uMR;
uniform sampler2D uEmit;
uniform sampler2D uDepth;
uniform sampler2D uAO;
uniform sampler2D uShadowMap;
uniform sampler2D uPrevLit;
uniform samplerCube uEnv;
uniform mat4 uShadowVP;
uniform mat4 uVP;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uGroundColor;
uniform float uEnvMips;
uniform float uEnvIntensity;
uniform float uShadowOn;
uniform vec2 uRes;
uniform float uTime;
uniform int uLightCount;
uniform vec4 uLightPos[64];   // xyz, radius
uniform vec4 uLightCol[64];   // rgb, intensity
uniform int uPortalCount;
uniform vec4 uPortalPos[10];  // xyz centre, w radius
uniform vec4 uPortalCol[10];  // rgb, intensity
uniform vec4 uPortalNrm[10];  // xyz outward-ish normal, w unused
uniform float uExposure;
uniform float uSSROn;
uniform float uFog;
uniform float uDebug;

vec3 worldAt(vec2 uv, float d) {
  vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 w = uInvVP * c; w /= w.w;
  return w.xyz;
}

// ---------- environment BRDF (Karis analytic fit) ----------
vec3 envBRDF(vec3 f0, float rough, float NoV) {
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = rough * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
  return f0 * AB.x + AB.y;
}

// ---------- soft sun shadow (rotated poisson) ----------
float sunShadow(vec3 P, vec3 N, float rough) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 L = uSunDir;
  // The ortho shadow map covers 80 m at 4096, so one texel is ~2 cm. A 2.5 cm
  // normal offset is inside a texel and self-shadowing a curved tube against a
  // grazing sun produces the horizontal banding that made the buoy stack read as
  // a striped inflatable. Offset by a few texels instead.
  vec4 lp = uShadowVP * vec4(P + N * 0.065, 1.0);
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float NoL = max(dot(N, L), 0.0);
  float bias = 0.0004 + 0.0016 * (1.0 - NoL);
  vec2 ts = 1.0 / vec2(textureSize(uShadowMap, 0));
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  float ca = cos(ang), sa = sin(ang);

  // --- PCSS blocker search ---------------------------------------------
  // The penumbra has to follow the real distance to the occluder. A constant
  // rough-driven blur smeared the close ribs of the barrel vault into large
  // brown blotches, because 4.6 texels of poisson noise projected onto a
  // grazing surface covers tens of screen pixels.
  const int NB = 8;
  float searchR = 4.0 + rough * 4.0;
  float bsum = 0.0, bcnt = 0.0;
  for (int i = 0; i < NB; i++) {
    float fi = float(i);
    float a = fi * 2.39996323 + ang;
    float r = sqrt((fi + 0.5) / float(NB));
    vec2 o = vec2(cos(a), sin(a)) * r * searchR;
    float d = texture(uShadowMap, p.xy + o * ts).r;
    if (d < p.z - bias) { bsum += d; bcnt += 1.0; }
  }
  if (bcnt < 0.5) return 1.0;

  // Ortho depth spans 1..170 m, so one unit of normalised z is 169 m and the
  // shadow map covers 80 m across 4096 texels (1.95 cm per texel).
  float distWorld = max((p.z - bsum / bcnt) * 169.0, 0.0);
  float penTex = clamp(distWorld * 2.25, 0.85, 22.0);

  const int NT = 16;
  float sum = 0.0;
  for (int i = 0; i < NT; i++) {
    float fi = float(i);
    float a = fi * 2.39996323;
    float r = sqrt((fi + 0.5) / float(NT));
    vec2 o = vec2(cos(a), sin(a)) * r * penTex;
    o = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca);
    float d = texture(uShadowMap, p.xy + o * ts).r;
    sum += (p.z - bias <= d) ? 1.0 : 0.0;
  }
  return sum / float(NT);
}

vec3 traceSSR(vec3 P, vec3 R, float rough, out float hitAmt) {
  hitAmt = 0.0;
  float maxDist = 34.0;
  float t = 0.05 + ign(gl_FragCoord.xy * 3.1) * 0.06;
  vec3 prev = P;
  for (int i = 0; i < 56; i++) {
    t += max(0.035, t * 0.05);
    if (t > maxDist) break;
    vec3 Q = P + R * t;
    vec4 cp = uVP * vec4(Q, 1.0);
    if (cp.w <= 0.0) break;
    vec2 uv = cp.xy / cp.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float d = texture(uDepth, uv).r;
    if (d >= 0.99999) { prev = Q; continue; }
    vec3 sp = worldAt(uv, d);
    if (length(sp - uCamPos) < length(Q - uCamPos)) {
      vec3 A = prev, B = Q;
      for (int j = 0; j < 8; j++) {
        vec3 M = (A + B) * 0.5;
        vec4 c2 = uVP * vec4(M, 1.0);
        vec2 u2 = c2.xy / c2.w * 0.5 + 0.5;
        float d2 = texture(uDepth, u2).r;
        vec3 s2 = worldAt(u2, d2);
        if (length(s2 - uCamPos) < length(M - uCamPos)) B = M; else A = M;
      }
      vec4 c3 = uVP * vec4(B, 1.0);
      vec2 u3 = c3.xy / c3.w * 0.5 + 0.5;
      float edge = smoothstep(0.0, 0.12, min(min(u3.x, 1.0 - u3.x), min(u3.y, 1.0 - u3.y)));
      hitAmt = edge * (1.0 - smoothstep(maxDist * 0.5, maxDist, t));
      // Temporal SSR: we cannot read the buffer we are writing, so the hit is
      // shaded from the previous frame's lit result. Reflecting raw albedo made
      // every tile reflection a flat grey copy of the wall.
      //
      // A single tap here was the source of the hard-edged white squares that
      // appeared on the tiled columns: the binary search converges to the same
      // few texels for a whole neighbourhood of pixels, so an emissive sconce
      // got copied out as a block. Five taps plus a radiance clamp turn it back
      // into the soft smear glazed ceramic actually shows.
      float sp = 0.0016 + 0.0045 * clamp(t / maxDist, 0.0, 1.0);
      vec3 lit = texture(uPrevLit, u3).rgb;
      lit += texture(uPrevLit, u3 + vec2( sp,  sp * 0.5)).rgb;
      lit += texture(uPrevLit, u3 + vec2(-sp,  sp * 0.4)).rgb;
      lit += texture(uPrevLit, u3 + vec2( sp * 0.3, -sp)).rgb;
      lit += texture(uPrevLit, u3 + vec2(-sp * 0.6, -sp * 0.7)).rgb;
      lit *= 0.2;
      vec3 albTap = texture(uAlbedo, u3).rgb * 0.30;
      return min(mix(albTap, lit, 0.88), vec3(7.0));
    }
    prev = Q;
  }
  return vec3(0.0);
}

void main() {
  float d = texture(uDepth, vUV).r;
  if (d >= 0.99999) { oColor = vec4(0.0); return; }

  vec3 P = worldAt(vUV, d);
  vec3 N = octDecode(texture(uNormal, vUV).xy * 2.0 - 1.0);
  vec4 alb = texture(uAlbedo, vUV);
  vec4 mr = texture(uMR, vUV);
  vec4 em = texture(uEmit, vUV);
  float ao = texture(uAO, vUV).r;

  vec3 V = normalize(uCamPos - P);
  float rough = clamp(mr.x, 0.025, 1.0);
  float metal = mr.y;
  float wet = mr.w;
  float NoV = max(dot(N, V), 1e-3);
  vec3 f0 = mix(vec3(0.045), alb.rgb, metal);
  float a = max(rough * rough, 1e-4);

  vec3 col = vec3(0.0);
  vec3 diffuse = vec3(0.0);
  vec3 specular = vec3(0.0);
  // debug accumulators (see uDebug 9..12)
  vec3 dbgSun = vec3(0.0);
  vec3 dbgLobe = vec3(0.0);
  vec3 dbgEnv = vec3(0.0);
  float dbgSh = 1.0;

  // ---------------- sun ----------------
  {
    vec3 L = uSunDir;
    float NoL = max(dot(N, L), 0.0);
    if (NoL > 0.0) {
      float sh = sunShadow(P, N, rough);
      vec3 H = normalize(L + V);
      float NoH = max(dot(N, H), 0.0);
      float VoH = max(dot(V, H), 0.0);
      float D = D_GGX(NoH, a);
      float Vis = V_SmithGGX(NoV, NoL, a);
      vec3 F = F_Schlick(f0, VoH);
      vec3 kd = (1.0 - F) * (1.0 - metal);
      diffuse += kd * alb.rgb * INV_PI * NoL * sh * uSunColor;
      specular += D * Vis * F * NoL * sh * uSunColor;
      dbgSun = kd * alb.rgb * INV_PI * NoL * sh * uSunColor;
      dbgSh = sh;
    }
  }

  // ---------------- point / sconce lights ----------------
  for (int i = 0; i < 64; i++) {
    if (i >= uLightCount) break;
    vec3 lp = uLightPos[i].xyz;
    float radius = max(uLightPos[i].w, 0.02);
    vec3 lv = lp - P;
    float dist2 = dot(lv, lv);
    // Hard range cut before any BRDF work. smoothstep(34, 5, dist2) is exactly
    // zero past dist2 = 34, so these lights contribute nothing; skipping them
    // here avoids evaluating GGX/Smith/Schlick for the ~44 lights that are out
    // of range at any given pixel.
    if (dist2 > 34.0) continue;
    vec3 l = lv * inversesqrt(max(dist2, 1e-6));
    float NoL = max(dot(N, l), 0.0);
    if (NoL <= 0.0) continue;
    // smooth distance window keeps light from bleeding through walls
    float win = 1.0 / (dist2 + radius * radius * 1.6 + 0.05);
    win *= smoothstep(34.0, 5.0, dist2);
    vec3 H = normalize(l + V);
    float NoH = max(dot(N, H), 0.0);
    float VoH = max(dot(V, H), 0.0);
    // Same area-source argument as the portals: a 0.22 m globe reflected in
    // glazed tile is a disc of finite angular size, not a point. Without the
    // floor on lobe width the sconces burned hard-edged white squares into the
    // tiled columns.
    float sinP = clamp(radius * inversesqrt(max(dist2, 1e-4)), 0.0, 0.999);
    float aa2 = max(a, sinP * 0.85);
    float D = D_GGX(NoH, aa2);
    float Vis = V_SmithGGX(NoV, NoL, aa2);
    vec3 F = F_Schlick(f0, VoH);
    vec3 kd = (1.0 - F) * (1.0 - metal);
    vec3 Li = uLightCol[i].rgb * uLightCol[i].w * win * NoL;
    diffuse += kd * alb.rgb * INV_PI * Li;
    specular += D * Vis * F * Li * 0.85;
  }

  // ---------------- portal lights (windows / skylight) ----------------
  for (int i = 0; i < 10; i++) {
    if (i >= uPortalCount) break;
    vec3 c = uPortalPos[i].xyz;
    float r = max(uPortalPos[i].w, 0.05);
    vec3 pn = normalize(uPortalNrm[i].xyz);
    vec3 lv = c - P;
    float dist2 = dot(lv, lv);
    // Cheap range cut. att = r^2/(dist2 + r^2*0.55) is below 1e-4 past ~60 m for
    // these portal radii, so the contribution is far under the noise floor.
    if (dist2 > 3600.0) continue;
    vec3 l = lv * inversesqrt(max(dist2, 1e-6));
    // one-sided: only light the side the opening faces
    float facing = smoothstep(-0.15, 0.25, dot(pn, -l));
    if (facing <= 0.0) continue;
    float sinA = clamp(r * inversesqrt(dist2), 0.0, 0.999);
    // wrapped cosine softens the terminator like a real area source
    float NoL = clamp((dot(N, l) + sinA * 0.85) / (1.0 + sinA * 0.85), 0.0, 1.0);
    if (NoL <= 0.0) continue;
    float att = (r * r) / (dist2 + r * r * 0.55);
    vec3 H = normalize(l + V);
    float NoH = max(dot(N, H), 0.0);
    float VoH = max(dot(V, H), 0.0);
    // A window is an AREA source: its mirror image on glazed tile is a soft
    // smear the size of the opening, never a crisp box. Clamping the lobe width
    // to the source's angular radius is what removes the hard-edged white
    // rectangles that used to sit on the columns.
    float aa2 = max(a, sinA * 0.55);
    float D = D_GGX(NoH, aa2);
    float Vis = V_SmithGGX(NoV, max(dot(N, l), 1e-3), aa2);
    vec3 F = F_Schlick(f0, VoH);
    vec3 kd = (1.0 - F) * (1.0 - metal);
    vec3 Li = uPortalCol[i].rgb * uPortalCol[i].w * att * NoL * facing;
    diffuse += kd * alb.rgb * INV_PI * Li;
    specular += D * Vis * F * Li * 0.72;
  }

  // ---------------- environment ----------------
  // One tap on a low mip aliases the vault: 12 ribs land on ~8 texels and beat
  // against them. On a torus the normal sweeps a full circle, so that beat turns
  // into the evenly spaced horizontal bands the rubber rings used to show.
  // A wide 5-tap cone at an even coarser mip averages the ribs away while the
  // sky/floor gradient (which is what actually shapes the shading) survives.
  vec3 irr;
  {
    float lodI = clamp(uEnvMips - 2.0, 0.0, uEnvMips - 1.0);
    vec3 upv = abs(N.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 e1 = normalize(cross(upv, N));
    vec3 e2 = cross(N, e1);
    const float CA[4] = float[4](0.0, 1.5707963, 3.1415927, 4.7123890);
    irr = textureLod(uEnv, N, lodI).rgb * 0.36;
    for (int k = 0; k < 4; k++) {
      vec3 Dk = normalize(N + (e1 * cos(CA[k]) + e2 * sin(CA[k])) * 0.90);
      irr += textureLod(uEnv, Dk, lodI).rgb * 0.16;
    }
    irr *= uEnvIntensity;
  }
  diffuse += alb.rgb * irr * mix(ao, 1.0, 0.28) * (1.0 - metal * 0.7);
  dbgEnv = alb.rgb * irr * ao * (1.0 - metal * 0.7);

  // hemispheric fill, split into two physical lobes: sky above, bright tile
  // floor below. A vault that faces straight down sees almost the whole floor,
  // so it must be lit by the floor lobe alone - the old single mix() gave it
  // the darkest part of the gradient.
  {
    float up = clamp(N.y, 0.0, 1.0);
    float dn = clamp(-N.y, 0.0, 1.0);
    float vert = clamp(1.0 - abs(N.y), 0.0, 1.0);
    // A vertical wall sees half the bright ceiling and half the bright floor,
    // so its irradiance must sit between the two lobes - not below both.
    float skyW = 0.090 + 0.300 * up + 0.250 * vert;
    float floorW = 0.170 + 0.900 * dn * dn + 0.330 * vert;
    // A recessed soffit only sees the recess, so GTAO hands it a very low value;
    // multiplying the already-weak floor lobe by it produced the black wedges
    // between the capitals and the vault. Real GI would fill those with bounce,
    // so clamp the occlusion instead of letting it reach zero.
    // This is also what keeps the shadow side of the red rings and the underside
    // of the slide from going to a flat near-black: a fill term that can reach 0
    // is not a fill term. AO now modulates the hemispheres by at most ~2:1.
    float aoS = mix(ao, 1.0, 0.62);
    float occ = clamp(aoS, 0.42, 1.0) * (1.0 - metal * 0.7);
    diffuse += alb.rgb * uSkyColor * skyW * occ;
    diffuse += alb.rgb * uGroundColor * floorW * occ;
    dbgLobe = alb.rgb * (uSkyColor * skyW + uGroundColor * floorW) * occ;
  }

  // ---------------- reflections ----------------
  // Specular weight. The old curve still gave rough painted plaster a 0.38 lobe,
  // which is why the vault was covered in blotchy mirror images of the env cube.
  // Glazed tile keeps ~0.95, matte paint drops to ~0.17.
  float gloss = 1.0 - smoothstep(0.02, 0.62, rough);
  {
    vec3 R = reflect(-V, N);
    vec3 up = abs(R.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 T1 = normalize(cross(up, R));
    vec3 T2 = cross(R, T1);
    // deterministic 4-tap glossy cone: averaging removes the per-pixel white
    // noise a single jittered ray produces on semi-rough rubber/plastic.
    float jr = pow(rough, 1.5) * 2.20;
    float lod = clamp(rough * uEnvMips * 1.35, 0.0, uEnvMips - 1.0);
    vec3 envCol = vec3(0.0);
    {
      const float ANG[4] = float[4](0.0, 1.5707963, 3.1415927, 4.7123890);
      const float RAD[4] = float[4](0.0, 1.0, 0.62, 1.0);
      for (int k = 0; k < 4; k++) {
        vec3 Rk = normalize(R + (T1 * cos(ANG[k]) + T2 * sin(ANG[k])) * jr * RAD[k]);
        envCol += textureLod(uEnv, Rk, lod).rgb;
      }
      envCol *= 0.25 * uEnvIntensity;
    }
    // Skip the trace entirely when the blend weight below is zero. The mix uses
    // (1 - smoothstep(0.07, 0.30, rough)), so any surface rougher than 0.30 gets
    // no SSR at all - but the full 56-step march plus 8-step bisection used to run
    // anyway. Most of the frame (paint, terrazzo, concrete, towel, wood) is in
    // that range.
    float hit = 0.0;
    vec3 ssrCol = (uSSROn > 0.5 && rough < 0.30) ? traceSSR(P, R, rough, hit) : vec3(0.0);
    vec3 refl = mix(envCol, ssrCol, hit * (1.0 - smoothstep(0.07, 0.30, rough)));
    // Screen-space hits are always somewhat wrong; let the baked cube carry a
    // floor of the reflection so a miss never reads as a hard dark patch.
    refl = mix(envCol, refl, 0.78 + 0.22 * hit);
    specular += refl * envBRDF(f0, rough, NoV) * gloss * mix(1.0, ao, 0.6);
  }

  col = diffuse + specular;

  // wet surfaces get a touch more specular punch
  col += specular * wet * 0.35;

  // ---------------- emissive ----------------
  col += em.rgb * em.a;

  // ---------------- aerial perspective ----------------
  float dist = length(P - uCamPos);
  // Warm, slightly green aerial haze. The old value was a cold blue-black chosen
  // for a night exterior; against a poolcore interior it turned every distant
  // surface into dirty slate.
  vec3 fogCol = vec3(0.245, 0.225, 0.150);
  col = mix(col, fogCol, (1.0 - exp(-dist * 0.0075)) * uFog);

  if (uDebug > 0.5) {
    if (uDebug < 1.5) col = N * 0.5 + 0.5;
    else if (uDebug < 2.5) col = alb.rgb;
    else if (uDebug < 3.5) col = vec3(ao);
    else if (uDebug < 4.5) col = vec3(rough, metal, wet);
    else if (uDebug < 5.5) col = diffuse;
    else if (uDebug < 6.5) col = specular;
    else if (uDebug < 7.5) col = vec3(mr.z);
    else if (uDebug < 8.5) col = em.rgb * em.a;
    else if (uDebug < 9.5) col = dbgSun;
    else if (uDebug < 10.5) col = dbgLobe;
    else if (uDebug < 11.5) col = dbgEnv;
    else if (uDebug < 12.5) col = vec3(dbgSh);
    // geometry mask: green = a surface was rasterised here, red = cleared G-buffer
    else if (uDebug < 13.5) col = step(0.99999, texture(uDepth, gl_FragCoord.xy / uRes).r) > 0.5 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    else col = vec3(0.0);
  }
  oColor = vec4(col, 1.0);
}
