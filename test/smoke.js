// Node smoke test for the pure-logic modules (grid, zoning, builders) with a tiny THREE stub.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
class Color {
  constructor(h) { this.set(h); }
  set(h) { if (typeof h === 'number') { this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255; } else if (h && h.r !== undefined) { this.r = h.r; this.g = h.g; this.b = h.b; } return this; }
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
}
class BufferAttribute { constructor(a, n) { this.array = a; this.itemSize = n; } }
class BufferGeometry { constructor() { this.attributes = {}; } setAttribute(n, a) { this.attributes[n] = a; } }
const ctx = vm.createContext({ THREE: { Color, BufferAttribute, BufferGeometry }, console, Math, Float32Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Map, Set, JSON, performance });
for (const f of ['util', 'grid', 'palette', 'geo', 'builders', 'zoning']) vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
const run = (code) => vm.runInContext(code, ctx);

run(`
const t0 = performance.now();
var grid = Grid.generate(1234, 11, 2);
console.log('grid cells', grid.cells.length, 'verts', grid.verts.length, 'ms', (performance.now() - t0).toFixed(0));
let neg = 0, minA = 1e9, maxA = 0, bad = 0, asym = 0, tri = 0;
for (const c of grid.cells) {
  const P = c.v.map(i => grid.verts[i]);
  let a = 0; for (let i = 0; i < 4; i++) { const p = P[i], q = P[(i+1)%4]; a += p[0]*q[1] - q[0]*p[1]; }
  a /= 2; if (a <= 0) neg++; minA = Math.min(minA, a); maxA = Math.max(maxA, a);
  // convexity
  for (let i = 0; i < 4; i++) { const p = P[i], q = P[(i+1)%4], r = P[(i+2)%4]; const cr = (q[0]-p[0])*(r[1]-q[1]) - (q[1]-p[1])*(r[0]-q[0]); if (cr <= 0) { bad++; break; } }
  for (let k = 0; k < 4; k++) { const nb = c.nb[k]; if (nb >= 0 && !grid.cells[nb].nb.includes(c.id)) asym++; }
}
console.log('non-positive', neg, 'nonconvex', bad, 'asym', asym, 'area', minA.toFixed(3), maxA.toFixed(3));
`);
run(`
var N = grid.cells.length, land = new Uint8Array(N);
const seed = 4242;
for (const c of grid.cells) {
  const f = 1 - c.r / 12 + 0.45 * (Util.fbm2(c.cx * 0.18, c.cz * 0.18, seed) - 0.5);
  const isl = Math.hypot(c.cx - 14, c.cz + 6) < 2.6 ? 1 : 0;
  land[c.id] = (f > 0.0 || isl) ? 1 : 0;
}
var memo = new Map();
var t1 = performance.now();
var Z = Zoning.compute(grid, land, seed, memo);
console.log('zoning ms', (performance.now() - t1).toFixed(1), JSON.stringify(Z.stats));
const counts = {}; for (const d of Z.descs) if (d) counts[d.t] = (counts[d.t] || 0) + 1;
console.log(JSON.stringify(counts));
// ASCII map
const sym = { house: 'H', garden: 'g', plaza: 'p', plazaSub: '.', field: '=', forest: 'F', meadow: ',', beach: '~', rocks: 'r', dock: 'D', tower: 'T', church: 'C', windmill: 'W', lighthouse: 'L' };
const W = 90, Hh = 45, rows = [];
for (let y = 0; y < Hh; y++) { rows.push(new Array(W).fill(' ')); }
for (const c of grid.cells) { const d = Z.descs[c.id]; if (!d) continue; const x = Math.round((c.cx + 24) / 48 * (W - 1)), y = Math.round((c.cz + 24) / 48 * (Hh - 1)); rows[y][x] = sym[d.t] || '?'; }
console.log(rows.map(r => r.join('')).join(String.fromCharCode(10)));
`);
run(`
for (const season of Palette.SEASONS) {
  const t2 = performance.now(); let tris = 0, nan = 0, glowTris = 0, maxT = 0;
  for (const c of grid.cells) {
    const d = Z.descs[c.id]; if (!d) continue;
    const r = Builders.build(grid, c, d, season);
    for (const g of [r.main, r.glow]) if (g) { const p = g.attributes.position.array; for (let i = 0; i < p.length; i++) if (!isFinite(p[i])) { nan++; break; } }
    const n = (r.main ? r.main.attributes.position.array.length / 9 : 0); tris += n; maxT = Math.max(maxT, n);
    if (r.glow) glowTris += r.glow.attributes.position.array.length / 9;
  }
  console.log(season, 'build ms', (performance.now() - t2).toFixed(0), 'tris', tris, 'glow', glowTris, 'maxCell', maxT, 'NaN cells', nan);
}
`);
