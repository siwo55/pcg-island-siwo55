'use strict';
// Shared helpers: seeded random, hashing, value noise, easing, colors.
const Util = (() => {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(a, b = 0, c = 0) {
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return h >>> 0;
  }
  const hash01 = (a, b = 0, c = 0) => hash(a, b, c) / 4294967296;

  // 2D value noise in [0,1]
  function noise2(x, y, seed = 0) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash01(xi, yi, seed), b = hash01(xi + 1, yi, seed);
    const c = hash01(xi, yi + 1, seed), d = hash01(xi + 1, yi + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm2(x, y, seed = 0, oct = 3) {
    let s = 0, amp = 0.5, norm = 0, f = 1;
    for (let i = 0; i < oct; i++) {
      s += noise2(x * f, y * f, seed + i * 17) * amp;
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return s / norm;
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const easeInBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; };
  const pick = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))];

  const _c = new THREE.Color();
  // Returns a new THREE.Color from a hex/Color, with optional brightness jitter.
  function col(hex, jitter = 0, r = Math.random()) {
    const c = new THREE.Color(hex);
    if (jitter) { const k = 1 + (r - 0.5) * 2 * jitter; c.r *= k; c.g *= k; c.b *= k; }
    return c;
  }
  function mixHex(a, b, t) { return new THREE.Color(a).lerp(_c.set(b), t); }

  return { mulberry32, hash, hash01, noise2, fbm2, clamp, lerp, smoothstep, easeOutBack, easeInBack, pick, col, mixHex };
})();
