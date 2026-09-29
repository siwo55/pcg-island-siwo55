'use strict';
// Irregular quad grid: hex lattice -> triangles -> random pair merge -> subdivide -> relax.
// All polygons are kept in "P-order": positive signed area in the (x, z) plane.
const Grid = (() => {
  function generate(seed, rings = 10, size = 2) {
    const rnd = Util.mulberry32(seed);
    const SQ3 = Math.sqrt(3);

    // 1. hex lattice points
    const pts = [];
    const idx = new Map();
    const k2 = (q, r) => q * 1000 + r;
    for (let q = -rings; q <= rings; q++) {
      for (let r = -rings; r <= rings; r++) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > rings) continue;
        idx.set(k2(q, r), pts.length);
        pts.push([size * (q + r / 2), size * (r * SQ3 / 2)]);
      }
    }

    // 2. triangles
    const tris = [];
    for (let q = -rings; q <= rings; q++) {
      for (let r = -rings; r <= rings; r++) {
        const a = idx.get(k2(q, r)), b = idx.get(k2(q + 1, r)), c = idx.get(k2(q, r + 1)), d = idx.get(k2(q + 1, r + 1));
        if (a !== undefined && b !== undefined && c !== undefined) tris.push([a, b, c]);
        if (b !== undefined && d !== undefined && c !== undefined) tris.push([b, d, c]);
      }
    }

    // 3. randomly merge neighbouring triangle pairs into quads
    const ek = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);
    const edgeTris = new Map();
    tris.forEach((t, ti) => {
      for (let i = 0; i < 3; i++) {
        const k = ek(t[i], t[(i + 1) % 3]);
        if (!edgeTris.has(k)) edgeTris.set(k, []);
        edgeTris.get(k).push(ti);
      }
    });
    const order = tris.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const used = new Uint8Array(tris.length);
    const polys = [];
    for (const ti of order) {
      if (used[ti]) continue;
      const t = tris[ti];
      const cands = [];
      for (let i = 0; i < 3; i++) {
        for (const o of edgeTris.get(ek(t[i], t[(i + 1) % 3]))) if (o !== ti && !used[o]) cands.push([o, i]);
      }
      used[ti] = 1;
      if (!cands.length) { polys.push(t.slice()); continue; }
      const [o, i] = cands[Math.floor(rnd() * cands.length)];
      used[o] = 1;
      const a = t[i], b = t[(i + 1) % 3], c = t[(i + 2) % 3];
      const w = tris[o].find((v) => v !== a && v !== b);
      polys.push([a, w, b, c]);
    }

    // 4. subdivide every polygon into quads
    const P = pts.map((p) => p.slice());
    const mids = new Map();
    const mid = (a, b) => {
      const k = ek(a, b);
      if (!mids.has(k)) { mids.set(k, P.length); P.push([(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2]); }
      return mids.get(k);
    };
    const quads = [];
    for (const poly of polys) {
      const n = poly.length;
      let cx = 0, cz = 0;
      for (const v of poly) { cx += P[v][0]; cz += P[v][1]; }
      const c = P.length; P.push([cx / n, cz / n]);
      const m = poly.map((v, k) => mid(v, poly[(k + 1) % n]));
      for (let k = 0; k < n; k++) quads.push([poly[k], m[k], c, m[(k + n - 1) % n]]);
    }

    // boundary vertices stay fixed
    const edgeCount = new Map();
    for (const q of quads) for (let k = 0; k < 4; k++) { const e = ek(q[k], q[(k + 1) % 4]); edgeCount.set(e, (edgeCount.get(e) || 0) + 1); }
    const fixed = new Uint8Array(P.length);
    for (const q of quads) for (let k = 0; k < 4; k++) {
      if (edgeCount.get(ek(q[k], q[(k + 1) % 4])) === 1) { fixed[q[k]] = 1; fixed[q[(k + 1) % 4]] = 1; }
    }
    const cnt = new Uint16Array(P.length);
    for (const q of quads) for (const v of q) cnt[v]++;

    // 5. relax toward squares
    const fx = new Float64Array(P.length), fz = new Float64Array(P.length);
    for (let it = 0; it < 48; it++) {
      fx.fill(0); fz.fill(0);
      for (const q of quads) {
        let cx = 0, cz = 0;
        for (const v of q) { cx += P[v][0]; cz += P[v][1]; }
        cx /= 4; cz /= 4;
        let vx = 0, vz = 0;
        for (let k = 0; k < 4; k++) {
          const dx = P[q[k]][0] - cx, dz = P[q[k]][1] - cz;
          if (k === 0) { vx += dx; vz += dz; } else if (k === 1) { vx += dz; vz -= dx; }
          else if (k === 2) { vx -= dx; vz -= dz; } else { vx -= dz; vz += dx; }
        }
        vx /= 4; vz /= 4;
        for (let k = 0; k < 4; k++) {
          let tx, tz;
          if (k === 0) { tx = vx; tz = vz; } else if (k === 1) { tx = -vz; tz = vx; }
          else if (k === 2) { tx = -vx; tz = -vz; } else { tx = vz; tz = -vx; }
          fx[q[k]] += cx + tx - P[q[k]][0];
          fz[q[k]] += cz + tz - P[q[k]][1];
        }
      }
      for (let i = 0; i < P.length; i++) {
        if (fixed[i] || !cnt[i]) continue;
        P[i][0] += (fx[i] / cnt[i]) * 0.55;
        P[i][1] += (fz[i] / cnt[i]) * 0.55;
      }
    }

    // 6. cells with neighbours across each edge (edge k: v[k] -> v[k+1])
    const edgeCell = new Map();
    quads.forEach((q, ci) => {
      for (let k = 0; k < 4; k++) {
        const e = ek(q[k], q[(k + 1) % 4]);
        if (!edgeCell.has(e)) edgeCell.set(e, []);
        edgeCell.get(e).push(ci);
      }
    });
    const vertCells = P.map(() => []);
    const cells = quads.map((q, ci) => {
      let cx = 0, cz = 0;
      for (const v of q) { cx += P[v][0]; cz += P[v][1]; vertCells[v].push(ci); }
      cx /= 4; cz /= 4;
      const nb = [];
      for (let k = 0; k < 4; k++) {
        const list = edgeCell.get(ek(q[k], q[(k + 1) % 4]));
        nb.push(list.length > 1 ? (list[0] === ci ? list[1] : list[0]) : -1);
      }
      return { id: ci, v: q, cx, cz, nb, r: Math.hypot(cx, cz) };
    });

    return { verts: P, cells, vertCells, radius: rings * size * 0.93, extent: rings * size };
  }

  function pointInCell(grid, cell, x, z) {
    const P = grid.verts;
    for (let k = 0; k < 4; k++) {
      const a = P[cell.v[k]], b = P[cell.v[(k + 1) % 4]];
      if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
    }
    return true;
  }

  function cellAt(grid, x, z) {
    let best = -1, bd = 1e9;
    for (const c of grid.cells) {
      const d = (c.cx - x) ** 2 + (c.cz - z) ** 2;
      if (d > 4) continue;
      if (pointInCell(grid, c, x, z)) return c.id;
      if (d < bd) { bd = d; best = c.id; }
    }
    return bd < 1.2 ? best : -1;
  }

  return { generate, cellAt, pointInCell };
})();
