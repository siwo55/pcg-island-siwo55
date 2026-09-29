'use strict';
// Low-poly geometry builder. Everything is written as flat-shaded triangles with
// per-vertex colors; normals are stored per face. Points are [x, y, z] arrays and
// 2D polygons are [x, z] arrays in "positive" order (see grid.js).
const Geo = (() => {
  const cache = new Map();
  function rgb(c) {
    if (Array.isArray(c)) return c;
    if (typeof c === 'number') {
      let v = cache.get(c);
      if (!v) { const k = new THREE.Color(c); v = [k.r, k.g, k.b]; cache.set(c, v); }
      return v;
    }
    return [c.r, c.g, c.b];
  }
  const tint = (c, k) => { const v = rgb(c); return [v[0] * k, v[1] * k, v[2] * k]; };
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]; };

  // polygon helpers (2D, [x,z])
  const centroid = (P) => { let x = 0, z = 0; for (const p of P) { x += p[0]; z += p[1]; } return [x / P.length, z / P.length]; };
  const scalePoly = (P, c, s) => P.map((p) => [c[0] + (p[0] - c[0]) * s, c[1] + (p[1] - c[1]) * s]);
  const rotPoly = (P, c, a) => {
    const ca = Math.cos(a), sa = Math.sin(a);
    return P.map((p) => { const dx = p[0] - c[0], dz = p[1] - c[1]; return [c[0] + dx * ca - dz * sa, c[1] + dx * sa + dz * ca]; });
  };
  const insetPoly = (P, c, d) => P.map((p) => {
    const dx = p[0] - c[0], dz = p[1] - c[1], l = Math.hypot(dx, dz) || 1;
    const k = Math.max(0.2, 1 - d / l);
    return [c[0] + dx * k, c[1] + dz * k];
  });
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const bil = (V, u, v) => {
    const a = lerp2(V[0], V[1], u), b = lerp2(V[3], V[2], u);
    return lerp2(a, b, v);
  };
  const circle = (cx, cz, r, n, rot = 0) => {
    const out = [];
    for (let i = 0; i < n; i++) { const a = rot + (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    return out;
  };
  const rectAt = (cx, cz, hx, hz, rot = 0) => {
    // positive order rectangle (see circle(): increasing angle is positive)
    const pts = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
    const ca = Math.cos(rot), sa = Math.sin(rot);
    return pts.map((p) => [cx + p[0] * ca - p[1] * sa, cz + p[0] * sa + p[1] * ca]);
  };
  const polyLen = (P, i) => { const a = P[i], b = P[(i + 1) % P.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); };

  class MB {
    constructor() { this.pos = []; this.col = []; this.nor = []; this.count = 0; }

    tri(a, b, c, c0, c1, c2) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9) return this;
      nx /= l; ny /= l; nz /= l;
      const k0 = rgb(c0), k1 = c1 ? rgb(c1) : k0, k2 = c2 ? rgb(c2) : k0;
      this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      this.nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      this.col.push(k0[0], k0[1], k0[2], k1[0], k1[1], k1[2], k2[0], k2[1], k2[2]);
      this.count += 3;
      return this;
    }
    // c0..c3 optional per-corner colors
    quad(a, b, c, d, c0, c1, c2, c3) {
      if (c1 === undefined) return this.tri(a, b, c, c0).tri(a, c, d, c0);
      return this.tri(a, b, c, c0, c1, c2).tri(a, c, d, c0, c2, c3);
    }
    // flat polygon (positive-order 2D points) at height y; up = facing +y
    cap(P, y, col, up = true) {
      for (let i = 1; i < P.length - 1; i++) {
        const a = [P[0][0], y, P[0][1]], b = [P[i][0], y, P[i][1]], c = [P[i + 1][0], y, P[i + 1][1]];
        if (up) this.tri(a, c, b, col); else this.tri(a, b, c, col);
      }
      return this;
    }
    // outward wall for edge A->B (2D, positive order)
    wall(A, B, y0, y1, col0, col1) {
      const c1 = col1 === undefined ? col0 : col1;
      return this.quad([A[0], y0, A[1]], [A[0], y1, A[1]], [B[0], y1, B[1]], [B[0], y0, B[1]], col0, c1, c1, col0);
    }
    // wall ring between two polygons of equal length (bottom P at yP, top Q at yQ)
    loft(P, yP, Q, yQ, colP, colQ) {
      const n = P.length, cq = colQ === undefined ? colP : colQ;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.quad([P[i][0], yP, P[i][1]], [Q[i][0], yQ, Q[i][1]], [Q[j][0], yQ, Q[j][1]], [P[j][0], yP, P[j][1]], colP, cq, cq, colP);
      }
      return this;
    }
    prism(P, y0, y1, col, colTop, top = true) {
      this.loft(P, y0, P, y1, col, colTop === undefined ? col : colTop);
      if (top) this.cap(P, y1, colTop === undefined ? col : colTop);
      return this;
    }
    // pyramid / cone over polygon P to apex point
    pyramid(P, y, apex, col, colApex) {
      const n = P.length, ca = colApex === undefined ? col : colApex;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        this.tri([P[i][0], y, P[i][1]], apex, [P[j][0], y, P[j][1]], col, ca, col);
      }
      return this;
    }
    // optional snow on the upper part of a cone (fraction of slope)
    cone(cx, y, cz, r, h, n, col, rot = 0, snow = 0, snowCol = 0xffffff) {
      const P = circle(cx, cz, r, n, rot);
      if (snow > 0) {
        const t = 1 - snow;
        const Q = circle(cx, cz, r * snow, n, rot);
        this.loft(P, y, Q, y + h * t, col);
        this.pyramid(Q, y + h * t, [cx, y + h, cz], snowCol);
      } else this.pyramid(P, y, [cx, y + h, cz], col);
      return this;
    }
    frustum(cx, y, cz, r0, r1, h, n, col, colTop, rot = 0, top = true) {
      const P = circle(cx, cz, r0, n, rot), Q = circle(cx, cz, r1, n, rot);
      this.loft(P, y, Q, y + h, col, colTop);
      if (top) this.cap(Q, y + h, colTop === undefined ? col : colTop);
      return this;
    }
    box(cx, y, cz, sx, sy, sz, col, rot = 0, colTop) {
      return this.prism(rectAt(cx, cz, sx / 2, sz / 2, rot), y, y + sy, col, colTop);
    }
    // jittered icosahedron blob
    blob(cx, cy, cz, r, col, rnd, sy = 1, jit = 0.12, shadeVar = 0.08) {
      const V = ICO_V.map((v) => {
        const k = 1 + (rnd ? (rnd() - 0.5) * 2 * jit : 0);
        return [cx + v[0] * r * k, cy + v[1] * r * k * sy, cz + v[2] * r * k];
      });
      for (const f of ICO_F) {
        const shade = 1 + (rnd ? (rnd() - 0.5) * 2 * shadeVar : 0);
        this.tri(V[f[0]], V[f[1]], V[f[2]], tint(col, shade));
      }
      return this;
    }
    // small octahedron (flowers, berries)
    gem(cx, cy, cz, r, col, sy = 1) {
      const T = [cx, cy + r * sy, cz], B = [cx, cy - r * sy, cz];
      const E = [[cx + r, cy, cz], [cx, cy, cz + r], [cx - r, cy, cz], [cx, cy, cz - r]];
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        this.tri(T, E[j], E[i], col);
        this.tri(B, E[i], E[j], col);
      }
      return this;
    }
    // merge another builder with an xz offset
    append(o) {
      for (let i = 0; i < o.pos.length; i++) this.pos.push(o.pos[i]);
      for (let i = 0; i < o.nor.length; i++) this.nor.push(o.nor[i]);
      for (let i = 0; i < o.col.length; i++) this.col.push(o.col[i]);
      this.count += o.count;
      return this;
    }
    build(ox = 0, oy = 0, oz = 0) {
      if (!this.count) return null;
      const p = new Float32Array(this.pos);
      if (ox || oy || oz) for (let i = 0; i < p.length; i += 3) { p[i] -= ox; p[i + 1] -= oy; p[i + 2] -= oz; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
      return g;
    }
  }

  // icosahedron
  const t = (1 + Math.sqrt(5)) / 2;
  const ICO_V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
  const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

  return { MB, rgb, tint, mix, centroid, scalePoly, rotPoly, insetPoly, lerp2, bil, circle, rectAt, polyLen };
})();
