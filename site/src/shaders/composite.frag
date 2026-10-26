#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oCol;

uniform sampler2D uHDR;
uniform sampler2D uBloom;
uniform sampler2D uDepth;
uniform sampler2D uVol;
uniform sampler2D uSoft;   // wide, soft copy of the HDR frame
uniform float uSoftAmt;    // white-diffusion strength
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform float uBloomStr;
uniform float uGrain;
uniform float uVignette;
uniform float uCA;
uniform float uFrame;
uniform float uVolStr;
uniform float uFocus;
uniform float uAperture;
uniform float uDOF;
uniform vec3 uCamPos;
uniform mat4 uInvVP;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec3 ACESFit(vec3 c) {
  const mat3 In = mat3(0.59719, 0.07600, 0.02840,
                       0.35458, 0.90834, 0.13383,
                       0.04823, 0.01566, 0.83777);
  const mat3 Out = mat3( 1.60475, -0.10208, -0.00327,
                        -0.53108,  1.10813, -0.07276,
                        -0.07367, -0.00605,  1.07602);
  c = In * c;
  vec3 a = c * (c + 0.0245786) - 0.000090537;
  vec3 b = c * (0.983729 * c + 0.4329510) + 0.238081;
  return clamp(Out * (a / b), 0.0, 1.0);
}

float viewDist(vec2 uv) {
  float d = texture(uDepth, uv).r;
  if (d >= 0.99999) return 1e4;
  vec4 w = uInvVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return length(w.xyz / w.w - uCamPos);
}

float cocAt(float z) {
  return clamp(abs(z - uFocus) / max(uFocus, 0.5) * uAperture, 0.0, 1.0);
}

void main() {
  vec2 uv = vUV;
  vec2 cc = uv - 0.5;
  float r2 = dot(cc, cc);

  // negative strength is a debug view of the raw in-scattering buffer
  if (uVolStr < 0.0) { oCol = vec4(texture(uVol, uv).rgb, 1.0); return; }

  vec3 sharp = texture(uHDR, uv).rgb;
  vec3 hdr = sharp;
  float coc0 = 0.0;

  if (uDOF > 0.5) {
    float z0 = viewDist(uv);
    coc0 = cocAt(z0);
    if (coc0 > 0.02) {
      vec3 sum = sharp * 2.0;
      float wsum = 2.0;
      float rad = coc0 * 0.0055;
      float ang0 = hash12(uv * uRes) * 6.2831853;
      // 8 taps instead of 14. Each tap calls viewDist(), which is a full inverse
      // view-projection multiply - this was one of the more expensive per-pixel
      // loops despite the modest tap count.
      for (int i = 0; i < 8; i++) {
        float a = ang0 + float(i) * 2.39996;
        float rr = sqrt((float(i) + 0.5) / 8.0) * rad;
        vec2 suv = uv + vec2(cos(a), sin(a)) * rr;
        float zz = viewDist(suv);
        // background taps always count; foreground taps fade in with their own CoC
        float w = (zz > z0) ? 1.0 : max(smoothstep(0.0, 0.06, cocAt(zz)), 0.05);
        sum += texture(uHDR, suv).rgb * w;
        wsum += w;
      }
      hdr = sum / wsum;
    }
  }

  vec3 col = hdr;
  if (uCA > 0.0) {
    vec2 dir = cc * uCA * (0.30 + r2 * 2.4);
    vec3 ca;
    ca.r = texture(uHDR, uv + dir).r;
    ca.g = sharp.g;
    ca.b = texture(uHDR, uv - dir).b;
    col = mix(ca, hdr, smoothstep(0.02, 0.30, coc0));
  }

  // volumetric god rays
  col += texture(uVol, uv).rgb * uVolStr;

  // bloom with warm halation
  vec3 bloom = texture(uBloom, uv).rgb;
  bloom = mix(bloom, bloom * vec3(1.07, 0.985, 0.93), 0.65);
  col += bloom * uBloomStr;

  // ---- exposure + tonemap ----
  col = ACESFit(max(col, 0.0) * uExposure);

  // ---- white diffusion (soft-focus veil) ----
  // Applied in DISPLAY space, after the tone curve, so it cannot change the
  // overall exposure or the black point - it only softens local contrast, which
  // is exactly what a diffusion filter in front of a lens does.
  //
  // The blend is a screen at low strength: it lifts the midtones very slightly
  // where the blur is bright, and leaves the darks almost untouched. A plain
  // mix() toward the blur would have flattened the whole frame.
  if (uSoftAmt > 0.001) {
    vec3 soft = texture(uSoft, vUV).rgb;
    // Screen-blend the blurred copy against itself at half weight. Because the
    // blur is a low-pass of the same image, this adds back a halo without
    // introducing new colour.
    vec3 veil = 1.0 - (1.0 - col) * (1.0 - soft * 0.5);
    // Preserve luminance: measure the change and scale it back so the frame does
    // not get brighter overall. Only the CONTRAST changes.
    float before = dot(col, vec3(0.2126, 0.7152, 0.0722));
    vec3 blended = mix(col, veil, uSoftAmt);
    float after = dot(blended, vec3(0.2126, 0.7152, 0.0722));
    // Rescale toward the original luminance. The 0.85 keeps a trace of the lift
    // so the image still reads as softer rather than merely desaturated.
    blended *= (before + 1e-4) / (after + 1e-4) * 0.85 + 0.15;
    col = clamp(blended, 0.0, 1.0);
  }

  // ---- grading, all in display space now ----
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));

  // chroma: nearly neutral in the deepest shadows so the vault reads as
  // architecture, then strongly saturated through the mids where the tile
  // tint, water and painted props live.
  float satMask = smoothstep(0.03, 0.42, l);
  col = mix(vec3(l), col, mix(1.10, 1.60, satMask));
  // pull the mid-tones off pure grey: pools read warm-white tile vs cool water
  col.r *= 1.0 + 0.012 * satMask;
  col.b *= 1.0 - 0.020 * satMask;
  // Gentle contrast about a mid pivot. A straight mix() about 0.36 expands to
  // 1.14*col - 0.0504, which maps EVERY value below 0.044 to exactly zero - a
  // hard black floor sitting right where the props' shadow side lives. Keep the
  // same slope through the mids but fade the operation out as we approach black
  // so the toe survives instead of being clipped flat.
  {
    // Reduced from 1.14. Dreamcore is low-contrast: the whole image should sit
    // in a narrow band, which is what makes it feel airless and unreal.
    vec3 hi = 0.36 + (col - 0.36) * 1.05;
    col = mix(col, hi, smoothstep(0.0, 0.16, l));
  }
  // Split toning: violet-blue shadows, sickly warm highlights. With the room now
  // lit mostly by shafts rather than fill, pushing the darks toward violet is what
  // makes the dim areas read as dreamlike instead of merely underexposed.
  vec3 shadowTint = vec3(0.855, 0.880, 1.135);
  vec3 highTint   = vec3(1.045, 1.018, 0.930);
  col *= mix(shadowTint, highTint, smoothstep(0.08, 0.66, l));
  // filmic shoulder so highlights roll off instead of clipping flat
  col = clamp(col, 0.0, 1.0);
  // Stronger shoulder: the emissive window panes must roll off softly rather
  // than clip to flat white, which was the most obviously "overexposed" part.
  col = col - 0.130 * col * col * col;
  // gentle lift so shadows are not crushed to pure black
  col = col * 0.995 + vec3(0.0012, 0.0022, 0.0045) * (1.0 - smoothstep(0.0, 0.30, l));
  col = clamp(col, 0.0, 1.0);

  // Vignette, pushed hard. A deep falloff at the frame edge is one of the most
  // reliable dreamcore cues: the image stops being a window and starts being a
  // remembered fragment. It also hides the flat, evenly-lit corners that were
  // reading as overexposed.
  float vig = 1.0 - uVignette * smoothstep(0.02, 1.05, r2 * 2.30);
  col *= vig;
  // A second, wider pass: even the mid-frame edges drop off.
  col *= 1.0 - 0.22 * smoothstep(0.10, 0.95, r2 * 2.60);

  col = pow(max(col, 0.0), vec3(1.0 / 2.2));

  // grain belongs in perceptual space. Adding it before the gamma curve made it
  // invisible in the highlights and turned every shadow into television static.
  float gp = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float g1 = hash12(uv * uRes + uFrame * 1.37) - 0.5;
  col += g1 * uGrain * (0.30 + 0.70 * smoothstep(0.015, 0.28, gp));
  col += (hash12(uv * uRes + 0.5) - 0.5) / 255.0;
  oCol = vec4(col, 1.0);
}
