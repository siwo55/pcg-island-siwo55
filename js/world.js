'use strict';
// World: owns the land mask, per-cell meshes, pop animations, shore masks.
class World {
  constructor(scene, grid, seed) {
    this.scene = scene;
    this.grid = grid;
    this.seed = seed;
    this.N = grid.cells.length;
    this.land = new Uint8Array(this.N);
    this.memo = new Map();
    this.season = 'spring';
    this.states = new Array(this.N).fill(null);
    this.pending = new Set();
    this.wanted = new Map();
    this.active = new Set();
    this.dirty = false;
    this.dirtyTimer = 0;
    this.onPlace = null;
    this.onRemove = null;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.stats = { land: 0, house: 0, tree: 0, field: 0 };
    this.onChange = null;
    this.time = 0;
    this.origin = [0, 0];

    // shared materials
    this.matMain = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.matGlow = new THREE.MeshBasicMaterial({ vertexColors: false, side: THREE.DoubleSide, color: 0x6fa0bd });
    this.haloTex = World.makeHaloTexture();
    this.matHalo = new THREE.SpriteMaterial({ map: this.haloTex, color: 0xffc46b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    this.matBeam = new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.matSmoke = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    this.matSpray = new THREE.MeshBasicMaterial({ color: 0xcdf2ff, transparent: true, opacity: 0.7, depthWrite: false });
    this.boatGeos = new Map();
    this.night = 0;
    this.wind = 0;

    // shore masks (top-down land rasters for the water shader and boat steering)
    this.maskExtent = grid.extent + 3;
    const mk = (s) => { const cv = document.createElement('canvas'); cv.width = cv.height = s; return cv; };
    this.maskSrc = mk(512);
    this.maskNear = mk(512);
    this.maskFar = mk(512);
    this.maskSmall = mk(96);
    this.texNear = new THREE.CanvasTexture(this.maskNear);
    this.texFar = new THREE.CanvasTexture(this.maskFar);
    for (const t of [this.texNear, this.texFar]) { t.flipY = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; }
    this.landRaster = new Uint8Array(96 * 96);
    this.maskDirty = true;
    this.maskTimer = 0;
    this.drawMasks();
  }

  static makeHaloTexture() {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  }

  // ---------------------------------------------------------------- land edits
  snapshot() { return this.land.slice(); }
  restore(snap) { this.land.set(snap); this.memo.clear(); this.origin = null; this.rezone({ origin: null }); }
  clear() { this.land.fill(0); this.memo.clear(); this.origin = [0, 0]; this.rezone({ origin: [0, 0] }); }

  paint(x, z, radius, value) {
    const cells = this.grid.cells;
    let changed = 0;
    for (let i = 0; i < this.N; i++) {
      const c = cells[i];
      const dx = c.cx - x, dz = c.cz - z;
      if (dx * dx + dz * dz > radius * radius * 2.1) continue;
      if (value && c.r > this.grid.radius - 1.2) continue;   // keep a strip of open sea around the grid
      const rr = radius * (0.78 + 0.44 * Util.hash01(i, this.seed, 55));
      if (dx * dx + dz * dz <= rr * rr && this.land[i] !== value) { this.land[i] = value; changed++; }
    }
    if (changed) { this.origin = [x, z]; this.dirty = true; }
    return changed;
  }

  // cells the brush would affect (for the preview)
  brushCells(x, z, radius) {
    const out = [];
    for (let i = 0; i < this.N; i++) {
      const c = this.grid.cells[i];
      const dx = c.cx - x, dz = c.cz - z;
      const rr = radius * (0.78 + 0.44 * Util.hash01(i, this.seed, 55));
      if (dx * dx + dz * dz <= rr * rr) out.push(i);
    }
    return out;
  }

  setSeason(season) {
    if (season === this.season) return;
    this.season = season;
    this.rezone({ origin: null, all: true });
  }

  // ---------------------------------------------------------------- rebuild
  // Re-run the zoning and queue every cell whose descriptor changed. `origin` is the
  // brush centre (waves start there); `all` forces a rebuild of every cell (season change).
  rezone(opts = {}) {
    const Z = Zoning.compute(this.grid, this.land, this.seed, this.memo);
    this.zoning = Z;
    this.stats = Z.stats;
    const origin = opts.origin === undefined ? this.origin : opts.origin;
    for (let i = 0; i < this.N; i++) {
      const d = Z.descs[i];
      const st = this.states[i];
      if (!d) {
        this.pending.delete(i); this.wanted.delete(i);
        if (st && !st.dying) this.kill(i);
        continue;
      }
      d.s = this.season;
      const key = JSON.stringify(d);
      const w = this.wanted.get(i);
      if (!opts.all && ((st && !st.dying && st.key === key && !w) || (w && w.key === key))) continue;
      const c = this.grid.cells[i];
      const delay = origin ? Math.hypot(c.cx - origin[0], c.cz - origin[1]) * 0.03 : c.r * 0.02;
      const fresh = !st || st.dying;
      this.pending.add(i);
      this.wanted.set(i, { desc: d, key, fresh, due: this.time + delay, delay: fresh ? delay : 0 });
    }
    this.maskDirty = true;
    if (this.onChange) this.onChange(this.stats);
  }

  // Build queued cells. Fresh cells are built at once (hidden until their pop starts);
  // replaced cells wait for their turn in the wave so a season change sweeps across the island.
  processPending(budget) {
    if (!this.pending.size) return;
    let n = 0;
    for (const i of this.pending) {
      const w = this.wanted.get(i);
      if (!w) { this.pending.delete(i); continue; }
      if (!w.fresh && w.due > this.time) continue;
      this.pending.delete(i);
      this.wanted.delete(i);
      this.buildCell(i, w);
      if (++n >= budget) break;
    }
  }

  buildCell(i, w) {
    const cell = this.grid.cells[i];
    const r = Builders.build(this.grid, cell, w.desc, this.season);
    let st = this.states[i];
    if (st && st.dying) { this.disposeCell(i); st = null; }
    if (st) this.clearParts(st);
    let group;
    if (!st) {
      group = new THREE.Group();
      group.position.set(r.origin[0], r.origin[1], r.origin[2]);
      this.root.add(group);
      st = this.states[i] = { group, key: '', parts: [], anims: [], scaleAnim: null, dying: false };
      this.active.add(i);
    } else group = st.group;
    st.key = w.key;
    if (r.main) {
      const m = new THREE.Mesh(r.main, this.matMain);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m); st.parts.push(m);
    }
    if (r.glow) {
      const m = new THREE.Mesh(r.glow, this.matGlow);
      group.add(m); st.parts.push(m);
    }
    for (const l of r.lamps) {
      const s = new THREE.Sprite(this.matHalo);
      s.position.set(l[0], l[1], l[2]);
      const sc = 0.55 * (l[3] || 1);
      s.scale.set(sc, sc, sc);
      s.userData.halo = true;
      group.add(s); st.parts.push(s);
    }
    for (const a of r.anims) this.addAnim(st, a);
    // pop animation: new cells grow out of the sea, replaced cells just bounce
    const wasFresh = w.fresh;
    st.scaleAnim = { t0: this.time + w.delay, dur: wasFresh ? 0.55 : 0.4, from: wasFresh ? 0 : 0.82, to: 1, dir: 1 };
    group.scale.setScalar(wasFresh ? 0.0001 : 1);
    group.visible = !wasFresh;
    this.active.add(i);
    if (wasFresh && this.onPlace) this.onPlace(cell);
  }

  addAnim(st, a) {
    const group = st.group;
    if (a.type === 'windmill') {
      const m = new THREE.Mesh(a.geo, this.matMain);
      m.castShadow = true;
      m.position.set(a.pos[0], a.pos[1], a.pos[2]);
      m.rotation.order = 'YXZ';
      m.rotation.y = -a.heading;
      group.add(m); st.parts.push(m);
      st.anims.push({ type: 'windmill', mesh: m, speed: a.speed });
    } else if (a.type === 'moored') {
      const key = a.seed + a.kind;
      let geo = this.boatGeos.get(key);
      if (!geo) { geo = Builders.boatGeometry(a.seed, a.kind); this.boatGeos.set(key, geo); }
      const m = new THREE.Mesh(geo, this.matMain);
      m.castShadow = true;
      m.position.set(a.pos[0], a.pos[1], a.pos[2]);
      m.rotation.order = 'YXZ';
      m.rotation.y = -a.heading;
      group.add(m); st.parts.push(m);
      st.anims.push({ type: 'moored', mesh: m, y0: m.position.y, phase: a.seed % 7 });
    } else if (a.type === 'beam') {
      const geo = new THREE.ConeGeometry(1.1, 9, 12, 1, true);
      geo.translate(0, -4.5, 0); geo.rotateZ(Math.PI / 2); // apex at origin, opens to +x
      const holder = new THREE.Group();
      holder.position.set(a.pos[0], a.pos[1], a.pos[2]);
      const m1 = new THREE.Mesh(geo, this.matBeam), m2 = new THREE.Mesh(geo, this.matBeam);
      m2.rotation.y = Math.PI;
      holder.add(m1, m2);
      group.add(holder); st.parts.push(holder);
      st.anims.push({ type: 'beam', mesh: holder, phase: a.phase });
    } else if (a.type === 'smoke') {
      const puffs = [];
      const geo = World.smokeGeo || (World.smokeGeo = new THREE.IcosahedronGeometry(0.05, 0));
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(geo, this.matSmoke);
        p.position.set(a.pos[0], a.pos[1], a.pos[2]);
        group.add(p); st.parts.push(p); puffs.push(p);
      }
      st.anims.push({ type: 'smoke', puffs, base: a.pos.slice(), phase: Math.random() * 3 });
    } else if (a.type === 'spray') {
      const puffs = [];
      const geo = World.sprayGeo || (World.sprayGeo = new THREE.OctahedronGeometry(0.022, 0));
      for (let i = 0; i < 5; i++) {
        const p = new THREE.Mesh(geo, this.matSpray);
        p.position.set(a.pos[0], a.pos[1], a.pos[2]);
        group.add(p); st.parts.push(p); puffs.push(p);
      }
      st.anims.push({ type: 'spray', puffs, base: a.pos.slice() });
    }
  }

  clearParts(st) {
    for (const p of st.parts) {
      st.group.remove(p);
      if (p.geometry && !p.userData.shared && p.geometry !== World.smokeGeo && p.geometry !== World.sprayGeo && !this.isBoatGeo(p.geometry)) p.geometry.dispose();
      if (p.isGroup) p.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    st.parts.length = 0; st.anims.length = 0;
  }
  isBoatGeo(g) { for (const v of this.boatGeos.values()) if (v === g) return true; return false; }

  kill(i) {
    const st = this.states[i];
    if (!st) return;
    const c = this.grid.cells[i];
    const d = this.origin ? Math.hypot(c.cx - this.origin[0], c.cz - this.origin[1]) * 0.02 : c.r * 0.01;
    st.dying = true;
    st.scaleAnim = { t0: this.time + d, dur: 0.32, from: st.group.scale.x, to: 0, dir: -1 };
    this.active.add(i);
  }

  disposeCell(i) {
    const st = this.states[i];
    if (!st) return;
    this.clearParts(st);
    this.root.remove(st.group);
    this.states[i] = null;
    this.active.delete(i);
    if (this.onRemove) this.onRemove(this.grid.cells[i]);
  }

  // ---------------------------------------------------------------- per-frame
  update(dt, night, wind) {
    this.time += dt;
    this.night = night;
    this.dirtyTimer -= dt;
    if (this.dirty && this.dirtyTimer <= 0) { this.dirty = false; this.dirtyTimer = 0.05; this.rezone({}); }
    this.processPending(this.pending.size > 300 ? 80 : 40);
    const t = this.time;
    for (const i of Array.from(this.active)) {
      const st = this.states[i];
      if (!st) { this.active.delete(i); continue; }
      const a = st.scaleAnim;
      if (a) {
        const k = (t - a.t0) / a.dur;
        if (k < 0) { if (a.dir > 0 && a.from === 0) st.group.visible = false; }
        else {
          st.group.visible = true;
          const e = Math.min(1, k);
          let s;
          if (a.dir > 0) s = a.from + (a.to - a.from) * Util.easeOutBack(e);
          else s = a.from * (1 - Util.easeInBack(e) * 1) ;
          st.group.scale.setScalar(Math.max(0.0001, s));
          if (k >= 1) {
            st.scaleAnim = null;
            if (a.dir < 0) { this.disposeCell(i); continue; }
            st.group.scale.setScalar(1);
          }
        }
      }
      for (const an of st.anims) this.tickAnim(an, t, dt, night);
      if (!st.scaleAnim && !st.anims.length) this.active.delete(i);
    }
    // halo + glow follow the night
    this.matHalo.opacity = Util.smoothstep(0.15, 0.7, night) * 0.85;
    this.matGlow.color.setRGB(0.26, 0.4, 0.5).lerp(World._warm || (World._warm = new THREE.Color(1.0, 0.84, 0.47)), Util.smoothstep(0.1, 0.65, night));
    this.matBeam.opacity = Util.smoothstep(0.35, 0.9, night) * 0.22;
    this.maskTimer -= dt;
    if (this.maskDirty && this.maskTimer <= 0) { this.maskDirty = false; this.maskTimer = 0.12; this.drawMasks(); }
  }

  tickAnim(an, t, dt, night) {
    switch (an.type) {
      case 'windmill': an.mesh.rotation.x += dt * an.speed * (0.5 + this.wind * 0.6); break;
      case 'moored': {
        const s = Math.sin(t * 1.3 + an.phase);
        an.mesh.position.y = an.y0 + s * 0.02;
        an.mesh.rotation.z = Math.sin(t * 0.9 + an.phase * 2) * 0.05;
        an.mesh.rotation.x = Math.cos(t * 1.1 + an.phase) * 0.03;
        break;
      }
      case 'beam': an.mesh.rotation.y = t * 0.9 + an.phase; an.mesh.visible = night > 0.3; break;
      case 'smoke': {
        for (let i = 0; i < an.puffs.length; i++) {
          const k = ((t * 0.28 + an.phase + i / an.puffs.length) % 1);
          const p = an.puffs[i];
          p.position.set(an.base[0] + k * 0.12 * (1 + this.wind), an.base[1] + k * 0.42, an.base[2] + Math.sin(k * 6 + i) * 0.02);
          p.scale.setScalar(0.5 + k * 1.6);
          p.visible = this.season !== 'summer' || i === 0;
        }
        break;
      }
      case 'spray': {
        for (let i = 0; i < an.puffs.length; i++) {
          const k = ((t * 0.9 + i / an.puffs.length) % 1);
          const a = i * 1.26 + 0.4, r = k * 0.12;
          an.puffs[i].position.set(an.base[0] + Math.cos(a) * r, an.base[1] + Math.sin(k * Math.PI) * 0.14 - k * 0.02, an.base[2] + Math.sin(a) * r);
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------- shore masks
  drawMasks() {
    const E = this.maskExtent, S = 512, k = S / (2 * E);
    const sg = this.maskSrc.getContext('2d');
    sg.fillStyle = '#000'; sg.fillRect(0, 0, S, S);
    sg.fillStyle = '#fff';
    sg.beginPath();
    const P = this.grid.verts;
    for (let i = 0; i < this.N; i++) {
      if (!this.land[i]) continue;
      const v = this.grid.cells[i].v;
      for (let j = 0; j < 4; j++) {
        const x = (P[v[j]][0] + E) * k, y = (P[v[j]][1] + E) * k;
        if (j === 0) sg.moveTo(x, y); else sg.lineTo(x, y);
      }
      sg.closePath();
    }
    sg.fill();
    const blit = (dst, blur) => {
      const g = dst.getContext('2d');
      g.filter = 'none'; g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
      g.filter = 'blur(' + blur + 'px)'; g.drawImage(this.maskSrc, 0, 0);
      g.filter = 'none';
    };
    blit(this.maskNear, 3.5);
    blit(this.maskFar, 13);
    this.texNear.needsUpdate = true; this.texFar.needsUpdate = true;
    // small raster for boat steering (dilated a little)
    const sm = this.maskSmall.getContext('2d');
    sm.filter = 'blur(1.2px)'; sm.fillStyle = '#000'; sm.fillRect(0, 0, 96, 96);
    sm.drawImage(this.maskSrc, 0, 0, 96, 96);
    sm.filter = 'none';
    try {
      const d = sm.getImageData(0, 0, 96, 96).data;
      for (let i = 0; i < 96 * 96; i++) this.landRaster[i] = d[i * 4] > 20 ? 1 : 0;
    } catch (e) { /* file:// canvas is never tainted for same-origin drawing, but be safe */ }
  }

  isLandAt(x, z) {
    const E = this.maskExtent;
    if (Math.abs(x) >= E || Math.abs(z) >= E) return false;
    const ix = Math.floor((x + E) / (2 * E) * 96), iz = Math.floor((z + E) / (2 * E) * 96);
    return this.landRaster[iz * 96 + ix] === 1;
  }

  // ---------------------------------------------------------------- utilities
  landCount() { let n = 0; for (let i = 0; i < this.N; i++) n += this.land[i]; return n; }

  islandBounds() {
    let sx = 0, sz = 0, n = 0, maxR = 0;
    for (let i = 0; i < this.N; i++) if (this.land[i]) { const c = this.grid.cells[i]; sx += c.cx; sz += c.cz; n++; }
    if (!n) return { x: 0, z: 0, r: 6 };
    sx /= n; sz /= n;
    for (let i = 0; i < this.N; i++) if (this.land[i]) { const c = this.grid.cells[i]; maxR = Math.max(maxR, Math.hypot(c.cx - sx, c.cz - sz)); }
    return { x: sx, z: sz, r: maxR };
  }

  randomIsland(seed) {
    this.seed = seed;
    this.memo.clear();
    const rnd = Util.mulberry32(seed);
    const R = 8 + rnd() * 3.5, lobes = [];
    const nl = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nl; i++) { const a = rnd() * 6.28, d = R * (0.35 + rnd() * 0.6); lobes.push([Math.cos(a) * d, Math.sin(a) * d, R * (0.35 + rnd() * 0.3)]); }
    const isl = [];
    const ni = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < ni; i++) { const a = rnd() * 6.28, d = R + 4 + rnd() * 3; isl.push([Math.cos(a) * d, Math.sin(a) * d, 1.6 + rnd() * 1.6]); }
    this.land.fill(0);
    for (const c of this.grid.cells) {
      let f = 1 - c.r / R;
      for (const l of lobes) f = Math.max(f, 1 - Math.hypot(c.cx - l[0], c.cz - l[1]) / l[2]);
      f += 0.5 * (Util.fbm2(c.cx * 0.17 + seed, c.cz * 0.17, seed) - 0.5);
      let on = f > 0.04;
      for (const l of isl) if (Math.hypot(c.cx - l[0], c.cz - l[1]) < l[2] * (0.8 + 0.4 * Util.fbm2(c.cx * 0.4, c.cz * 0.4, seed))) on = true;
      if (c.r > this.grid.radius - 1.5) on = false;
      this.land[c.id] = on ? 1 : 0;
    }
  }
}
