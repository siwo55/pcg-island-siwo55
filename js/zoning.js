'use strict';
// PCG zoning: decides what every land cell becomes (house, forest, field, landmark ...).
// Pure function of (grid, land mask, seed, landmark memo) so it can be re-run after every edit.
const Zoning = (() => {
  const BASE_Y = 0.55;
  const HILL_STEP = 0.28;
  const LANDMARKS = ['tower', 'church', 'windmill'];
  const TOWN_W = 0.55, HOUSE_T = 0.45;
  const LM_SCALE = { tower: 1.0, church: 0.95, windmill: 0.85 };

  function compute(grid, land, seed, memo) {
    const cells = grid.cells, N = cells.length;
    const H = Util.hash01;
    const dist = new Int16Array(N), comp = new Int32Array(N).fill(-1), seaEdges = new Uint8Array(N);

    // distance to sea (BFS over edge neighbours)
    let queue = [];
    for (let i = 0; i < N; i++) {
      if (!land[i]) continue;
      let se = 0;
      for (let k = 0; k < 4; k++) { const nb = cells[i].nb[k]; if (nb < 0 || !land[nb]) se++; }
      seaEdges[i] = se;
      if (se > 0) { dist[i] = 1; queue.push(i); }
    }
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h];
      for (let k = 0; k < 4; k++) { const nb = cells[i].nb[k]; if (nb >= 0 && land[nb] && !dist[nb]) { dist[nb] = dist[i] + 1; queue.push(nb); } }
    }

    // connected components
    const comps = [];
    for (let i = 0; i < N; i++) {
      if (!land[i] || comp[i] >= 0) continue;
      const list = [i]; comp[i] = comps.length;
      let maxD = 0, anchor = i;
      for (let h = 0; h < list.length; h++) {
        const c = list[h];
        if (dist[c] > maxD) maxD = dist[c];
        if (c < anchor) anchor = c;
        for (let k = 0; k < 4; k++) { const nb = cells[c].nb[k]; if (nb >= 0 && land[nb] && comp[nb] < 0) { comp[nb] = comps.length; list.push(nb); } }
      }
      comps.push({ id: comps.length, cells: list, size: list.length, maxD, anchor });
    }

    // ---- landmarks (with memory so they do not jump around while painting)
    const landmark = new Map(); // cell -> {type, sc}
    const lmCenters = [];
    const farEnough = (i, minD) => lmCenters.every((p) => Math.hypot(p[0] - cells[i].cx, p[1] - cells[i].cz) >= minD);
    const claim = (i, type) => {
      const d = dist[i];
      const sc = (type === 'lighthouse') ? 1 : (1 + 0.22 * Math.min(d - 1, 3)) * LM_SCALE[type];
      landmark.set(i, { type, sc });
      lmCenters.push([cells[i].cx, cells[i].cz]);
      memo.set(i, type);
    };
    for (const C of comps) {
      const cand = C.cells;
      const compType = () => LANDMARKS[Math.floor(H(C.anchor, seed, 11) * 3)];
      if (C.size >= 20) {
        // keep valid remembered landmarks
        for (const [id, type] of Array.from(memo)) {
          if (comp[id] !== C.id || !land[id] || type === 'lighthouse' || dist[id] < 2 || landmark.has(id)) continue;
          if (farEnough(id, 5)) claim(id, type);
        }
        const wanted = 1 + Math.floor(C.size / 170);
        let have = cand.filter((i) => landmark.has(i) && landmark.get(i).type !== 'lighthouse').length;
        if (have < wanted) {
          const sorted = cand.filter((i) => dist[i] >= 2 && !landmark.has(i)).sort((a, b) => (dist[b] - dist[a]) || (H(a, seed, 12) - H(b, seed, 12)));
          for (const i of sorted) {
            if (have >= wanted) break;
            if (!farEnough(i, 5.5)) continue;
            claim(i, have === 0 ? compType() : LANDMARKS[Math.floor(H(i, seed, 13) * 3)]);
            have++;
          }
        }
      }
      if (C.size >= 50) {
        let has = null;
        for (const [id, type] of memo) if (type === 'lighthouse' && comp[id] === C.id && land[id] && dist[id] === 1) has = id;
        if (has !== null && !landmark.has(has)) claim(has, 'lighthouse');
        else if (has === null) {
          let best = -1, bs = -1;
          for (const i of cand) {
            if (dist[i] !== 1 || landmark.has(i) || seaEdges[i] < 2 || !farEnough(i, 3)) continue;
            let far = 0; for (const p of lmCenters) far = Math.max(far, Math.hypot(p[0] - cells[i].cx, p[1] - cells[i].cz));
            const s = far + H(i, seed, 14) * 3 + seaEdges[i];
            if (s > bs) { bs = s; best = i; }
          }
          if (best >= 0) claim(best, 'lighthouse');
        }
      }
    }
    for (const id of Array.from(memo.keys())) if (!landmark.has(id)) memo.delete(id);

    // plaza cells around landmarks
    const sub = new Set();
    for (const [id, lm] of landmark) {
      if (lm.type === 'lighthouse') continue;
      const c = cells[id], rad = lm.sc * 0.95;
      for (const i of comps[comp[id]].cells) {
        if (i === id || landmark.has(i)) continue;
        if (Math.hypot(cells[i].cx - c.cx, cells[i].cz - c.cz) < rad) sub.add(i);
      }
    }

    // ---- per-cell descriptors
    const descs = new Array(N).fill(null);
    const stats = { land: 0, house: 0, tree: 0, field: 0, other: 0 };
    for (let i = 0; i < N; i++) {
      if (!land[i]) continue;
      stats.land++;
      const cell = cells[i], d = dist[i], C = comps[comp[i]];
      const h1 = H(i, seed, 1), h2 = H(i, seed, 2), h3 = H(i, seed, 3), h4 = H(i, seed, 4);
      const desc = { t: 'meadow', g: BASE_Y, seed: Util.hash(i, seed, 99), low: [null, null, null, null] };
      if (landmark.has(i)) {
        const lm = landmark.get(i);
        desc.t = lm.type; desc.sc = Math.round(lm.sc * 100) / 100;
        desc.rc = Math.floor(h2 * Palette.roofs.length);
        desc.tiers = 4 + Math.floor(h3 * 3);
        desc.heading = Math.round(h4 * 628) / 100;
        desc.door = Math.floor(h1 * 4);
      } else if (sub.has(i)) {
        desc.t = 'plazaSub';
      } else {
        const townN = Util.fbm2(cell.cx * 0.11 + seed * 0.0137, cell.cz * 0.11 - seed * 0.0091, seed, 3);
        const natN = Util.fbm2(cell.cx * 0.16 - 50, cell.cz * 0.16 + 30, seed + 5, 3);
        const hillN = Util.fbm2(cell.cx * 0.09 + 10, cell.cz * 0.09 - 5, seed + 9, 2);
        const depthN = C.maxD > 1 ? (d - 1) / (C.maxD - 1) : 0;
        let score = TOWN_W * townN + (1 - TOWN_W) * depthN + (h1 - 0.5) * 0.1 + (d === 1 && seaEdges[i] <= 1 ? 0.1 : 0);
        if (C.size < 10) score = 0;
        const hillLevel = () => Math.floor(Util.clamp((d - 1.5) / 2.5, 0, 1) * Util.clamp((hillN - 0.42) * 6, 0, 2.99));
        if (score > HOUSE_T) {
          desc.t = 'house';
          const v = Util.clamp(score - HOUSE_T + 0.08, 0, 0.3) / 0.3;
          desc.fl = 1 + (h2 < 0.55 ? 1 : 0) + (h3 < v * 0.75 ? 1 : 0) + (h4 < v * 0.3 ? 1 : 0);
          const cn = Util.fbm2(cell.cx * 0.3 + 7, cell.cz * 0.3 + 3, seed + 21, 2);
          const wr = h2 < 0.35 ? h3 : Util.clamp((cn - 0.25) * 1.6, 0, 0.999);
          desc.wc = Math.floor(Util.clamp(wr, 0, 0.999) * Palette.walls.length);
          desc.rc = Math.floor(H(i, seed, 5) * Palette.roofs.length);
          desc.roof = h3 < 0.33 ? 'hip' : 'gable';
          desc.chim = h4 < 0.4;
        } else if (score > HOUSE_T - 0.08) {
          if (h1 < 0.22) { desc.t = 'plaza'; desc.pv = Math.floor(h2 * 4); desc.lamps = (h3 < 0.5 ? 0b0101 : 0b1010) & Math.floor(h4 * 16 + 1); }
          else desc.t = 'garden';
        } else if (d === 1) {
          if (seaEdges[i] >= 2 || h1 < 0.5) { desc.t = 'beach'; desc.tp = 0.45; }
          else if (h2 < 0.3) desc.t = 'rocks';
          else { desc.t = 'meadow'; desc.tp = 0.6; }
          if (C.size < 10 && h2 < 0.35) desc.t = 'rocks';
        } else if (natN > 0.47 || C.size < 10) {
          desc.t = 'forest'; desc.n = 3 + Math.floor(h2 * 3); desc.pine = Math.round((0.25 + natN * 0.7) * 100) / 100;
          desc.g = BASE_Y + hillLevel() * HILL_STEP;
        } else if (natN < 0.36 && d >= 2 && C.size >= 30) {
          desc.t = 'field'; desc.rot = h2 < 0.5 ? 0 : 1;
        } else {
          desc.t = 'meadow'; desc.tp = 0.35;
          desc.g = BASE_Y + hillLevel() * HILL_STEP;
        }
      }
      // cluster-dependent tweak for tiny sandbars
      descs[i] = desc;
    }

    // docks: coast beach cells with a sea edge, spaced apart
    const docks = [];
    for (let i = 0; i < N; i++) {
      const d = descs[i];
      if (!d || d.t !== 'beach' || seaEdges[i] < 1 || H(i, seed, 7) > 0.16 || comps[comp[i]].size < 25) continue;
      const cell = cells[i];
      if (docks.some((p) => Math.hypot(p[0] - cell.cx, p[1] - cell.cz) < 3.2)) continue;
      // choose a sea-facing edge that has open water for a few cells (so the pier is not inside another cell)
      let edge = -1;
      for (let k = 0; k < 4; k++) if (cell.nb[k] < 0 || !land[cell.nb[k]]) { edge = k; if (H(i, seed, 8 + k) < 0.5) break; }
      if (edge < 0) continue;
      d.t = 'dock'; d.dk = edge; d.g = BASE_Y;
      docks.push([cell.cx, cell.cz]);
    }

    // second pass: neighbour heights + door edges + stats
    for (let i = 0; i < N; i++) {
      const d = descs[i];
      if (!d) continue;
      const cell = cells[i];
      for (let k = 0; k < 4; k++) {
        const nb = cell.nb[k];
        if (nb < 0 || !land[nb]) d.low[k] = -2;
        else if (descs[nb].g < d.g - 0.001) d.low[k] = Math.round((descs[nb].g - 0.09) * 1000) / 1000;
      }
      if (d.t === 'house' || d.t === 'tower' || d.t === 'church' || d.t === 'lighthouse') {
        let best = -1, bs = -1;
        for (let k = 0; k < 4; k++) {
          const nb = cell.nb[k];
          let s = H(i, seed, 30 + k) * 0.5;
          if (nb >= 0 && land[nb]) { const t = descs[nb].t; s += (t === 'house') ? 0.2 : 1; }
          if (s > bs) { bs = s; best = k; }
        }
        d.door = best;
      }
      if (d.t === 'house') stats.house++;
      else if (d.t === 'forest') stats.tree += d.n;
      else if (d.t === 'field') stats.field++;
      else stats.other++;
    }
    stats.landmarks = landmark.size;
    stats.docks = docks.length;
    return { descs, dist, comp, comps, stats };
  }

  return { compute, BASE_Y };
})();
