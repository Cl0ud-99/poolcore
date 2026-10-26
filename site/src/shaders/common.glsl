// ---------------- shared GLSL ----------------
const float PI = 3.14159265359;
const float INV_PI = 0.31830988618;

uint hashU(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
float hash1(uvec3 v) { return float(hashU(v) & 0xFFFFFFu) / 16777215.0; }

vec3 hash3(uvec3 v) {
  return vec3(hash1(v), hash1(v + uvec3(17u,0u,0u)), hash1(v + uvec3(0u,31u,0u)));
}

float vnoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  ivec3 b = ivec3(i) + ivec3(65536);
  float n000 = hash1(uvec3(b));
  float n100 = hash1(uvec3(b + ivec3(1,0,0)));
  float n010 = hash1(uvec3(b + ivec3(0,1,0)));
  float n110 = hash1(uvec3(b + ivec3(1,1,0)));
  float n001 = hash1(uvec3(b + ivec3(0,0,1)));
  float n101 = hash1(uvec3(b + ivec3(1,0,1)));
  float n011 = hash1(uvec3(b + ivec3(0,1,1)));
  float n111 = hash1(uvec3(b + ivec3(1,1,1)));
  return mix(mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y),
             mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y), u.z);
}

float fbm(vec3 p, int oct) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise(p); n += a; p = p * 2.03 + 17.1; a *= 0.5;
  }
  return s / n;
}

float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float d = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * d * d + 1e-9);
}
float V_SmithGGX(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / (gv + gl + 1e-7);
}
vec3 F_Schlick(vec3 f0, float u) { return f0 + (1.0 - f0) * pow(1.0 - u, 5.0); }

vec2 octEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z) + 1e-8);
  vec2 e = n.xy;
  if (n.z < 0.0) e = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return e;
}
vec3 octDecode(vec2 e) {
  vec3 n = vec3(e.xy, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 ACESFitted(vec3 color) {
  const mat3 ACESInputMat = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777);
  const mat3 ACESOutputMat = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602);
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}
