'use strict';
// Orbit camera + brush input (left paints land, right erases, wheel resizes the brush).

class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.t = new THREE.Vector3(0, 0.5, 0);     // current look-at
    this.gt = new THREE.Vector3(0, 0.5, 0);    // goal
    this.yaw = this.gyaw = 0.55;
    this.pitch = this.gpitch = 0.92;
    this.dist = this.gdist = 36;
    this.keys = new Set();
    this.update(0);
  }
  rotate(dx, dy) {
    this.gyaw -= dx * 0.0055;
    this.gpitch = Util.clamp(this.gpitch + dy * 0.0045, 0.2, 1.42);
  }
  // `s` is world units per pixel (mouse default is a bit faster than 1:1; touch passes an exact value)
  pan(dx, dy, s) {
    if (s === undefined) s = this.dist * 0.0017;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.gt.x += -dx * s * cy + dy * s * -sy;
    this.gt.z += dx * s * sy + dy * s * -cy;
    this.clampTarget();
  }
  zoom(dir) { this.zoomBy(Math.exp(dir * 0.1)); }
  zoomBy(f) { this.gdist = Util.clamp(this.gdist * f, 9, CameraRig.MAX_DIST); }
  clampTarget() {
    const m = 22, l = Math.hypot(this.gt.x, this.gt.z);
    if (l > m) { this.gt.x *= m / l; this.gt.z *= m / l; }
  }
  focus(x, z, dist) {
    this.gt.set(x, 0.5, z); this.clampTarget();
    if (dist) this.gdist = Util.clamp(dist, 9, CameraRig.MAX_DIST);
  }
  update(dt) {
    const k = dt > 0 ? 1 - Math.exp(-dt * 11) : 1;
    // keyboard: WASD / arrows pan, Q/E rotate, +/- zoom
    if (dt > 0 && this.keys.size) {
      const K = this.keys, sp = this.dist * 0.9 * dt;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      const fw = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
      const rt = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
      if (fw || rt) {
        this.gt.x += (-sy * fw + cy * rt) * sp * 0.6;
        this.gt.z += (-cy * fw - sy * rt) * sp * 0.6;
        this.clampTarget();
      }
      if (K.has('KeyQ')) this.gyaw += 1.3 * dt;
      if (K.has('KeyE')) this.gyaw -= 1.3 * dt;
    }
    this.yaw += (this.gyaw - this.yaw) * k;
    this.pitch += (this.gpitch - this.pitch) * k;
    this.dist += (this.gdist - this.dist) * k;
    this.t.lerp(this.gt, k);
    const cp = Math.cos(this.pitch);
    this.camera.position.set(
      this.t.x + Math.sin(this.yaw) * cp * this.dist,
      this.t.y + Math.sin(this.pitch) * this.dist,
      this.t.z + Math.cos(this.yaw) * cp * this.dist
    );
    this.camera.lookAt(this.t);
  }
}

CameraRig.MAX_DIST = 92;

class Input {
  constructor(dom, camera, scene, world, rig, hooks) {
    this.dom = dom; this.camera = camera; this.scene = scene; this.world = world; this.rig = rig; this.hooks = hooks || {};
    this.radius = 2.4;
    this.tool = 'add';           // what one finger does on a touch screen: 'add' | 'del' | 'look'
    this.touches = new Map();    // active touch pointers -> {x, y}
    this.gesture = null;         // last two-finger state {d, ang, cx, cy}
    this.locked = false;         // after a two-finger gesture the remaining finger is ignored until all are up
    this.touchT0 = 0;
    this.mode = null;            // 'add' | 'del' while a stroke is active
    this.drag = null;            // 'rotate' | 'pan' while a camera drag is active
    this.mx = -1; this.my = -1; this.inside = false;
    this.hover = null;
    this.last = null;
    this.undo = []; this.redo = [];
    this.raycaster = new THREE.Raycaster();
    this.buildPreview();
    this.bind();
  }

  buildPreview() {
    const pts = [];
    for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a))); }
    this.ringMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false });
    this.ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), this.ringMat);
    this.ring.renderOrder = 20; this.ring.frustumCulled = false; this.ring.visible = false;
    this.scene.add(this.ring);
    const max = 420;
    this.hiPos = new Float32Array(max * 6 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.hiPos, 3));
    g.setDrawRange(0, 0);
    this.addMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
    this.delMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.38, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.hi = new THREE.Mesh(g, this.addMat);
    this.hi.renderOrder = 19; this.hi.frustumCulled = false; this.hi.visible = false;
    this.scene.add(this.hi);
    this.maxHi = max;
  }

  bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    d.addEventListener('pointerdown', (e) => this.onDown(e));
    d.addEventListener('pointermove', (e) => this.onMove(e));
    d.addEventListener('pointerup', (e) => this.onUp(e));
    d.addEventListener('pointercancel', (e) => this.onUp(e));
    d.addEventListener('pointerleave', () => { this.inside = false; });
    d.addEventListener('pointerenter', () => { this.inside = true; });
    d.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => {
      this.rig.keys.clear(); this.endStroke(); this.drag = null;
      this.touches.clear(); this.gesture = null; this.locked = false;
    });
  }

  setPointer(e) {
    const r = this.dom.getBoundingClientRect();
    this.mx = e.clientX - r.left; this.my = e.clientY - r.top; this.inside = true;
  }

  // ground position under the pointer (plane at land height)
  pick(x, y) {
    const r = this.dom.getBoundingClientRect();
    this.camera.updateMatrixWorld();
    const nx = (x / r.width) * 2 - 1, ny = -(y / r.height) * 2 + 1;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const o = this.raycaster.ray.origin, dir = this.raycaster.ray.direction, py = 0.5;
    if (dir.y > -1e-4) return null;
    const t = (py - o.y) / dir.y;
    if (t < 0) return null;
    return { x: o.x + dir.x * t, z: o.z + dir.z * t };
  }

  onDown(e) {
    this.setPointer(e);
    try { this.dom.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (this.hooks.onFirstInput) this.hooks.onFirstInput();
    if (e.pointerType === 'touch') { this.touchDown(e); return; }
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.drag = e.shiftKey ? 'pan' : 'rotate';
      this.px = e.clientX; this.py = e.clientY;
      return;
    }
    if (e.button === 0 || e.button === 2) {
      this.mode = e.button === 0 ? 'add' : 'del';
      this.strokeSnap = this.world.snapshot();
      this.last = null;
      this.stroke();
    }
  }

  onMove(e) {
    this.setPointer(e);
    if (e.pointerType === 'touch') { this.touchMove(e); return; }
    if (this.drag) {
      const dx = e.clientX - this.px, dy = e.clientY - this.py;
      this.px = e.clientX; this.py = e.clientY;
      if (this.drag === 'rotate') this.rig.rotate(dx, dy); else this.rig.pan(dx, dy);
      return;
    }
    if (this.mode) this.stroke();
  }

  onUp(e) {
    try { this.dom.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (e.pointerType === 'touch') { this.touchUp(e); return; }
    this.drag = null;
    this.endStroke();
  }

  // ---------------------------------------------------------------- touch
  // one finger: paint / erase / rotate depending on the selected tool; two fingers: pinch = zoom,
  // twist = rotate, drag = pan (whatever the tool)
  setTool(t) {
    this.tool = t;
    if (this.hooks.onTool) this.hooks.onTool(t);
  }

  touchDown(e) {
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size >= 2) {
      // a second finger means camera gesture: throw away a stroke that only just started
      if (this.mode && performance.now() - this.touchT0 < 350) {
        this.world.restore(this.strokeSnap);
        this.mode = null; this.strokeSnap = null; this.last = null;
      } else this.endStroke();
      this.locked = true;
      this.drag = 'gesture';
      this.gesture = this.pair();
      return;
    }
    this.locked = false;
    this.touchT0 = performance.now();
    if (this.tool === 'look') { this.drag = 'rotate'; return; }
    this.mode = this.tool === 'del' ? 'del' : 'add';
    this.strokeSnap = this.world.snapshot();
    this.last = null;
    this.stroke();
  }

  touchMove(e) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (this.touches.size >= 2) { this.updateGesture(); return; }
    if (this.locked) return;
    if (this.drag === 'rotate') this.rig.rotate(dx, dy);
    else if (this.mode) this.stroke();
  }

  touchUp(e) {
    this.touches.delete(e.pointerId);
    if (this.touches.size >= 2) { this.gesture = this.pair(); return; }
    this.gesture = null;
    if (this.touches.size === 1) return;      // keep ignoring the last finger until it lifts too
    this.locked = false;
    this.drag = null;
    this.endStroke();
    this.inside = false;
  }

  pair() {
    const it = this.touches.values(), a = it.next().value, b = it.next().value;
    return { d: Math.hypot(b.x - a.x, b.y - a.y) || 1, ang: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  updateGesture() {
    const g = this.gesture || (this.gesture = this.pair()), n = this.pair();
    this.rig.zoomBy(g.d / n.d);
    let da = n.ang - g.ang;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    this.rig.gyaw += da;
    const h = this.dom.getBoundingClientRect().height || 800;
    this.rig.pan(n.cx - g.cx, n.cy - g.cy, 2 * this.rig.dist * Math.tan(this.camera.fov * Math.PI / 360) / h);
    this.gesture = n;
  }

  stroke() {
    const p = this.pick(this.mx, this.my);
    if (!p) return;
    const value = this.mode === 'add' ? 1 : 0;
    let changed = 0;
    const step = Math.max(0.3, this.radius * 0.45);
    if (this.last) {
      const dx = p.x - this.last.x, dz = p.z - this.last.z, L = Math.hypot(dx, dz), n = Math.ceil(L / step);
      for (let i = 1; i <= n; i++) changed += this.world.paint(this.last.x + dx * i / n, this.last.z + dz * i / n, this.radius, value);
    } else changed += this.world.paint(p.x, p.z, this.radius, value);
    this.last = p;
    if (changed && this.hooks.onPaint) this.hooks.onPaint(this.mode, changed);
  }

  endStroke() {
    if (!this.mode) return;
    this.mode = null; this.last = null;
    const a = this.strokeSnap, b = this.world.land;
    let diff = false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff = true; break; }
    if (diff) { this.undo.push(a); if (this.undo.length > 60) this.undo.shift(); this.redo.length = 0; }
    this.strokeSnap = null;
  }

  doUndo() {
    if (!this.undo.length) return;
    this.redo.push(this.world.snapshot());
    this.world.restore(this.undo.pop());
    if (this.hooks.onHistory) this.hooks.onHistory('undo');
  }
  doRedo() {
    if (!this.redo.length) return;
    this.undo.push(this.world.snapshot());
    this.world.restore(this.redo.pop());
    if (this.hooks.onHistory) this.hooks.onHistory('redo');
  }
  // used by "random island" / "clear": remember the previous state so it can be undone
  remember() { this.undo.push(this.world.snapshot()); if (this.undo.length > 60) this.undo.shift(); this.redo.length = 0; }

  setRadius(r) {
    this.radius = Util.clamp(Math.round(r * 20) / 20, 0.6, 6);
    if (this.hooks.onBrush) this.hooks.onBrush(this.radius);
  }

  onWheel(e) {
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    if (!dir) return;
    if (e.ctrlKey) this.rig.zoom(dir);
    else this.setRadius(this.radius * (dir > 0 ? 0.9 : 1.11));
  }

  onKey(e, down) {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (down && this.hooks.onFirstInput) this.hooks.onFirstInput();
    const code = e.code;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
      if (e.ctrlKey || e.metaKey) return;
      if (down) this.rig.keys.add(code); else this.rig.keys.delete(code);
      if (down && code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (!down) return;
    if ((e.ctrlKey || e.metaKey) && code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) this.doRedo(); else this.doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && code === 'KeyY') { e.preventDefault(); this.doRedo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const h = this.hooks;
    if (code === 'Digit1' && h.onSeason) h.onSeason('spring');
    else if (code === 'Digit2' && h.onSeason) h.onSeason('summer');
    else if (code === 'Digit3' && h.onSeason) h.onSeason('autumn');
    else if (code === 'Digit4' && h.onSeason) h.onSeason('winter');
    else if (code === 'KeyR' && h.onRandom) h.onRandom();
    else if (code === 'KeyM' && h.onMute) h.onMute();
    else if (code === 'Space' && h.onPause) { e.preventDefault(); h.onPause(); }
    else if (code === 'KeyF' && h.onFocus) h.onFocus();
    else if (code === 'BracketLeft') this.setRadius(this.radius * 0.88);
    else if (code === 'BracketRight') this.setRadius(this.radius * 1.14);
    else if (code === 'Equal' || code === 'NumpadAdd') this.rig.zoom(-1);
    else if (code === 'Minus' || code === 'NumpadSubtract') this.rig.zoom(1);
  }

  // per-frame: keep the brush preview under the cursor
  update() {
    const show = this.inside && !this.drag && this.mx >= 0;
    const p = show ? this.pick(this.mx, this.my) : null;
    this.hover = p;
    if (!p) { this.ring.visible = false; this.hi.visible = false; return; }
    const del = this.mode === 'del';
    this.ring.visible = true;
    this.ring.position.set(p.x, 0.8, p.z);
    this.ring.scale.set(this.radius, 1, this.radius);
    this.ringMat.color.set(del ? 0xff6a5a : 0xffffff);
    // highlight the cells the brush would change
    const w = this.world, cells = w.grid.cells, P = w.grid.verts;
    const list = w.brushCells(p.x, p.z, this.radius);
    let n = 0;
    const a = this.hiPos;
    for (const i of list) {
      const isLand = w.land[i] === 1;
      if (del !== isLand) continue;        // add mode: only water cells; erase mode: only land cells
      if (n >= this.maxHi) break;
      const desc = w.zoning && w.zoning.descs[i];
      const y = isLand ? (desc ? desc.g : 0.55) + 0.03 : 0.17;
      const v = cells[i].v;
      const q = [P[v[0]], P[v[1]], P[v[2]], P[v[3]]];
      const o = n * 18;
      const put = (k, pt) => { a[o + k * 3] = pt[0]; a[o + k * 3 + 1] = y; a[o + k * 3 + 2] = pt[1]; };
      put(0, q[0]); put(1, q[1]); put(2, q[2]); put(3, q[0]); put(4, q[2]); put(5, q[3]);
      n++;
    }
    const g = this.hi.geometry;
    g.attributes.position.needsUpdate = true;
    g.setDrawRange(0, n * 6);
    this.hi.material = del ? this.delMat : this.addMat;
    this.hi.visible = n > 0;
  }
}
