// Runtime smoke test: runs every script (incl. main.js) against a strict THREE stub + fake DOM.
// It cannot check how anything looks, only that the code paths execute without exceptions and
// that the numbers that come out (colours, positions, counts) are finite.
// Unknown methods on the stub throw, so a typo in a THREE call shows up as a TypeError.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');

// ---------------------------------------------------------------- THREE stub
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = this.y = this.z = s; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  normalize() { const l = Math.hypot(this.x, this.y, this.z) || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
}
class Color {
  constructor(h, g, b) { this.r = 1; this.g = 1; this.b = 1; if (h !== undefined) this.set(h, g, b); }
  set(h) {
    if (typeof h === 'number') { this.r = ((h >> 16) & 255) / 255; this.g = ((h >> 8) & 255) / 255; this.b = (h & 255) / 255; }
    else if (h && h.r !== undefined) { this.r = h.r; this.g = h.g; this.b = h.b; }
    else throw new Error('Color.set bad arg ' + h);
    return this;
  }
  setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
  setScalar(s) { this.r = this.g = this.b = s; return this; }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  clone() { return new Color().copy(this); }
  lerp(c, t) { this.r += (c.r - this.r) * t; this.g += (c.g - this.g) * t; this.b += (c.b - this.b) * t; return this; }
  multiply(c) { this.r *= c.r; this.g *= c.g; this.b *= c.b; return this; }
  multiplyScalar(s) { this.r *= s; this.g *= s; this.b *= s; return this; }
  getHex() { return ((this.r * 255) << 16) | ((this.g * 255) << 8) | (this.b * 255); }
}
class Euler { constructor() { this.x = 0; this.y = 0; this.z = 0; this.order = 'XYZ'; } }
class Object3D {
  constructor() {
    this.position = new Vector3(); this.rotation = new Euler(); this.scale = new Vector3(1, 1, 1);
    this.children = []; this.visible = true; this.userData = {}; this.castShadow = false; this.receiveShadow = false;
    this.frustumCulled = true; this.renderOrder = 0; this.parent = null;
  }
  add(...o) { for (const x of o) { if (!x || !x.position) throw new Error('add: not an Object3D'); x.parent = this; this.children.push(x); } return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) this.children.splice(i, 1); o.parent = null; return this; }
  traverse(f) { f(this); for (const c of this.children) c.traverse(f); }
  updateMatrixWorld() {}
  lookAt(v) { this._look = v.clone(); }
}
class Group extends Object3D { constructor() { super(); this.isGroup = true; } }
class Scene extends Object3D { constructor() { super(); this.fog = null; } }
class Fog { constructor(c, n, f) { this.color = new Color(c); this.near = n; this.far = f; } }
class PerspectiveCamera extends Object3D {
  constructor(fov, aspect, near, far) { super(); this.fov = fov; this.aspect = aspect; this.near = near; this.far = far; }
  updateProjectionMatrix() {}
}
class DirectionalLight extends Object3D {
  constructor(c, i) {
    super(); this.color = new Color(c); this.intensity = i; this.target = new Object3D();
    this.shadow = { mapSize: { set() {} }, camera: { updateProjectionMatrix() { this.projected = true; } }, bias: 0, normalBias: 0, radius: 1 };
  }
}
class HemisphereLight extends Object3D {
  constructor(c, g, i) { super(); this.color = new Color(c); this.groundColor = new Color(g); this.intensity = i; }
}
class BufferAttribute {
  constructor(a, n) { if (!(a instanceof Float32Array) && !(a instanceof Uint16Array) && !(a instanceof Uint32Array)) throw new Error('BufferAttribute: bad array'); this.array = a; this.itemSize = n; this.needsUpdate = false; this.count = a.length / n; }
}
class BufferGeometry {
  constructor() { this.attributes = {}; this.drawRange = { start: 0, count: Infinity }; this.disposed = false; }
  setAttribute(n, a) { if (!(a instanceof BufferAttribute)) throw new Error('setAttribute: not a BufferAttribute'); this.attributes[n] = a; return this; }
  setDrawRange(s, c) { this.drawRange = { start: s, count: c }; }
  setFromPoints(pts) { const a = new Float32Array(pts.length * 3); pts.forEach((p, i) => { a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z; }); this.attributes.position = new BufferAttribute(a, 3); return this; }
  translate() { return this; } rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; }
  dispose() { this.disposed = true; }
}
const primGeo = () => class extends BufferGeometry { constructor(...a) { super(); this.params = a; } };
class Material {
  constructor(p = {}) {
    this.color = new Color(0xffffff); this.opacity = 1; this.transparent = false; this.blending = 1;
    for (const k of Object.keys(p)) {
      if (k === 'color') this.color = new Color(p.color); else this[k] = p[k];
    }
  }
}
class MeshLambertMaterial extends Material { constructor(p) { super(p); this.emissive = new Color(0); } }
class Texture { constructor(c) { this.image = c; this.needsUpdate = false; } }
class Mesh extends Object3D {
  constructor(g, m) { super(); if (!g || !m) throw new Error('Mesh needs geometry+material'); this.geometry = g; this.material = m; }
}
class Sprite extends Object3D { constructor(m) { super(); if (!m) throw new Error('Sprite needs material'); this.material = m; } }
class Raycaster {
  constructor() { this.ray = { origin: new Vector3(), direction: new Vector3() }; }
  setFromCamera(c, cam) {
    // aim at what the camera looks at; the screen offset moves the ray sideways/forward a little
    const L = cam._look || new Vector3(), o = cam.position;
    this.ray.origin.copy(o);
    this.ray.direction.set(L.x - o.x + c.x * 8, L.y - o.y, L.z - o.z - c.y * 8).normalize();
  }
}

const drawn = { calls: 0 };
class WebGLRenderer {
  constructor(o) {
    this.domElement = o.canvas; this.shadowMap = {}; this.info = { render: { calls: 0, triangles: 0 } };
  }
  setPixelRatio() {} setSize() {} setClearColor(c) { if (!c || c.r === undefined || !isFinite(c.r + c.g + c.b)) throw new Error('bad clear colour'); }
  render(scene, cam) { drawn.calls++; drawn.scene = scene; drawn.cam = cam; }
}

const THREE = {
  Vector3, Color, Object3D, Group, Scene, Fog, PerspectiveCamera, DirectionalLight, HemisphereLight, BufferAttribute, BufferGeometry,
  PlaneGeometry: primGeo(), SphereGeometry: primGeo(), ConeGeometry: primGeo(), IcosahedronGeometry: primGeo(), OctahedronGeometry: primGeo(),
  MeshLambertMaterial, MeshBasicMaterial: Material, SpriteMaterial: Material, ShaderMaterial: Material, PointsMaterial: Material, LineBasicMaterial: Material,
  CanvasTexture: Texture, Mesh, Points: Mesh, LineLoop: Mesh, Sprite, Raycaster, WebGLRenderer,
  DoubleSide: 2, BackSide: 1, AdditiveBlending: 2, NormalBlending: 1, LinearFilter: 1006, PCFSoftShadowMap: 2,
};

// ---------------------------------------------------------------- fake DOM
const listeners = {};
const fakeCtx = new Proxy({}, {
  get: (t, k) => {
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k in t) return t[k];
    return () => {};
  },
  set: (t, k, v) => { t[k] = v; return true; },
});
function el(id) {
  const e = {
    id, style: {}, dataset: {}, textContent: '', innerHTML: '', value: '360', disabled: false,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined ? !this._s.has(c) : on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener(t, f) { (listeners[id + ':' + t] = listeners[id + ':' + t] || []).push(f); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1400, height: 900 }),
    setPointerCapture() {}, releasePointerCapture() {}, blur() {},
    getContext: () => fakeCtx, width: 512, height: 512,
  };
  return e;
}
const elems = {};
const seasonBtns = ['spring', 'summer', 'autumn', 'winter'].map((s) => { const b = el('btn-' + s); b.dataset.s = s; return b; });
const toolBtns = ['add', 'del', 'look'].map((t) => { const b = el('tool-' + t); b.dataset.tool = t; return b; });
const document = {
  getElementById(id) { return elems[id] || (elems[id] = (id === 'c' ? Object.assign(el('c'), { width: 1400, height: 900, clientWidth: 1400, clientHeight: 900 }) : el(id))); },
  createElement(tag) { return el(tag); },
  querySelectorAll(sel) { return /tool/.test(sel) ? toolBtns : seasonBtns; },
  body: Object.assign(el('body'), { classList: el('x').classList }),
};
const win = {
  innerWidth: 1400, innerHeight: 900, devicePixelRatio: 1,
  addEventListener(t, f) { (listeners['window:' + t] = listeners['window:' + t] || []).push(f); },
};
let rafCb = null;
const query = process.argv[2] || '?season=summer&instant=1&debug=1&seed=12345&touch=1';
const sandbox = {
  THREE, document, window: win, location: { search: query }, URLSearchParams, console, Math, Float32Array, Int16Array, Int32Array, Uint8Array, Uint8ClampedArray,
  Uint16Array, Uint32Array, Map, Set, JSON, Date, Array, Object, Number, String, Promise, Infinity, isFinite, isNaN, parseFloat, parseInt,
  performance: { now: () => Date.now() },
  requestAnimationFrame: (f) => { rafCb = f; return 1; },
  setTimeout: (f, ms) => { return 1; }, clearTimeout() {},
};
win.AudioContext = undefined;
sandbox.window.THREE = THREE;
const ctx = vm.createContext(sandbox);
for (const f of ['util', 'grid', 'palette', 'geo', 'builders', 'zoning', 'world', 'env', 'life', 'audio', 'input', 'main']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
}

const app = sandbox.window.__app || vm.runInContext('window.__app', ctx);
if (!app) { console.error('FAIL: main.js did not create __app (see the error above)'); console.error('load text:', elems.load && elems.load.textContent); process.exit(1); }

let t = Date.now();
const step = (n, dt = 16) => { for (let i = 0; i < n; i++) { t += dt; const f = rafCb; f(t); } };
const check = (name, cond, extra) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (extra !== undefined ? ' ' + extra : '')); if (!cond) process.exitCode = 1; };
const finite = (v) => Number.isFinite(v);

step(30);
const w = app.world;
check('frames rendered', drawn.calls >= 30, drawn.calls);
check('land cells', w.landCount() > 100, w.landCount());
check('all land built', w.pending.size === 0 && [...Array(w.N).keys()].every((i) => !w.land[i] || w.states[i]), 'pending ' + w.pending.size);
check('stats shown', +elems.sHouse.textContent > 0 && +elems.sLand.textContent === w.landCount(), elems.sHouse.textContent + ' houses, ' + elems.sLand.textContent + ' land');
check('camera finite', finite(app.camera.position.x + app.camera.position.y + app.camera.position.z), JSON.stringify([app.camera.position.x, app.camera.position.y, app.camera.position.z].map((v) => +v.toFixed(1))));
check('clock text', /^\d\d:\d\d$/.test(elems.clock.textContent), elems.clock.textContent);

// every geometry attribute finite
let bad = 0, meshes = 0, verts = 0;
w.root.traverse((o) => {
  if (o.geometry && o.geometry.attributes.position) {
    meshes++;
    const a = o.geometry.attributes.position.array; verts += a.length / 3;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { bad++; break; }
  }
});
check('geometry finite', bad === 0, meshes + ' meshes, ' + verts + ' verts, bad ' + bad);
for (const b of app.boats.boats) check('boat position finite', finite(b.mesh.position.x + b.mesh.position.y + b.mesh.position.z + b.mesh.rotation.x + b.mesh.rotation.z));
app.birds.flocks.forEach((f) => f.birds.forEach((b) => { if (!finite(b.mesh.position.x + b.mesh.position.y + b.mesh.rotation.y)) check('bird finite', false); }));

// seasons
for (const s of ['spring', 'summer', 'autumn', 'winter']) {
  app.setSeason(s); step(90);
  check('season ' + s, app.world.season === s && app.world.pending.size === 0 && document.body.dataset.season === s, 'pending ' + app.world.pending.size + ' fog ' + app.scene.fog.color.getHex().toString(16));
}

// time of day sweep
for (let k = 0; k < 24; k++) {
  app.env.time = k / 24; step(2);
  const e = app.env;
  if (![e.night, e.sun.intensity, e.hemi.intensity, e.wind, e.scene.fog.color.r, e.sunDir.y, e.lightDir.y].every(finite)) check('time ' + k, false);
}
check('time sweep', true);

// brush strokes through the real event handlers
const fire = (type, ev) => (listeners['c:' + type] || []).forEach((f) => f(Object.assign({ preventDefault() {}, pointerId: 1, button: 0, clientX: 700, clientY: 450, altKey: false, shiftKey: false, ctrlKey: false, deltaY: 0 }, ev)));
const land0 = w.landCount();
app.world.clear(); step(60);
check('clear', w.landCount() === 0 && w.states.every((s) => !s), 'states left ' + w.states.filter(Boolean).length);
fire('pointerenter', {});
fire('pointerdown', { button: 0, clientX: 700, clientY: 450 });
for (let i = 0; i < 12; i++) { fire('pointermove', { clientX: 700 + i * 14, clientY: 450 }); step(1); }
fire('pointerup', {});
step(60);
check('paint adds land', w.landCount() > 5, w.landCount() + ' cells, houses ' + w.stats.house);
check('undo entry pushed', app.input.undo.length >= 1, app.input.undo.length);
const painted = w.landCount();
fire('wheel', { deltaY: 100 }); const r1 = app.input.radius;
fire('wheel', { deltaY: -100 }); fire('wheel', { deltaY: -100 });
check('wheel changes brush', app.input.radius > r1, r1.toFixed(2) + ' -> ' + app.input.radius.toFixed(2) + ' label ' + elems.brushVal.textContent);
fire('pointerdown', { button: 2, clientX: 700, clientY: 450 });
fire('pointermove', { clientX: 720, clientY: 450 }); step(1);
fire('pointerup', {});
step(60);
check('right click erases', w.landCount() < painted, painted + ' -> ' + w.landCount());
app.input.doUndo(); step(60);
check('undo restores', w.landCount() === painted, w.landCount());
app.input.doRedo(); step(60);
check('redo erases again', w.landCount() < painted, w.landCount());
app.randomIsland(); step(120);
check('random island', w.landCount() > 100 && w.pending.size === 0, w.landCount());
// keyboard
const key = (code, down = true) => (listeners['window:' + (down ? 'keydown' : 'keyup')] || []).forEach((f) => f({ code, target: { tagName: 'BODY' }, preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }));
['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Space', 'KeyM', 'KeyM', 'KeyF', 'BracketRight', 'Equal'].forEach((c) => { key(c); step(3); });
key('KeyW'); step(10); key('KeyW', false); key('KeyQ'); step(10); key('KeyQ', false);
check('keyboard handled', app.world.season === 'winter');
// buttons
for (const id of ['random', 'clear', 'undo', 'redo', 'pause', 'speed', 'sound']) (listeners[id + ':click'] || []).forEach((f) => f({ currentTarget: elems[id] || el(id), target: elems[id] || el(id) }));
step(120);
check('buttons handled', true, 'land ' + w.landCount());
// ---------------------------------------------------------------- touch
{
  const tfire = (type, id, x, y) => fire(type, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, button: 0 });
  check('touch class set', document.body.classList.contains('touch'));
  app.world.clear(); step(60);
  app.input.setTool('add');
  tfire('pointerdown', 1, 700, 450);
  for (let i = 0; i < 10; i++) { tfire('pointermove', 1, 700 + i * 12, 450); step(1); }
  tfire('pointerup', 1, 820, 450); step(60);
  const tp = w.landCount();
  check('touch paint', tp > 3 && app.input.undo.length >= 1, tp + ' cells');
  check('touch ring hidden after lift', app.input.inside === false);

  const g0 = { d: app.rig.gdist, y: app.rig.gyaw, x: app.rig.gt.x, z: app.rig.gt.z };
  // pinch out
  tfire('pointerdown', 1, 600, 450); tfire('pointerdown', 2, 800, 450);
  tfire('pointermove', 2, 900, 450); tfire('pointermove', 1, 500, 450);
  check('pinch out zooms in', app.rig.gdist < g0.d, g0.d.toFixed(1) + ' -> ' + app.rig.gdist.toFixed(1));
  // twist: rotate the pair clockwise by moving finger 2 downward
  const yaw1 = app.rig.gyaw;
  tfire('pointermove', 2, 900, 550);
  check('twist rotates', app.rig.gyaw !== yaw1, yaw1.toFixed(2) + ' -> ' + app.rig.gyaw.toFixed(2));
  // pan: both fingers move right
  const gx = app.rig.gt.x, gz = app.rig.gt.z;
  tfire('pointermove', 1, 560, 450); tfire('pointermove', 2, 960, 550);
  check('two-finger pan moves target', app.rig.gt.x !== gx || app.rig.gt.z !== gz);
  // lifting one finger must not start painting with the other
  const before = w.landCount();
  tfire('pointerup', 1, 560, 450);
  tfire('pointermove', 2, 700, 300); step(30);
  tfire('pointerup', 2, 700, 300); step(30);
  check('gesture never paints', w.landCount() === before && !app.input.mode);
  check('gesture state cleared', app.input.touches.size === 0 && app.input.drag === null && !app.input.locked);

  // second finger arriving right after the first cancels the tentative stroke
  const undoN = app.input.undo.length, cells0 = w.landCount();
  tfire('pointerdown', 1, 300, 450);
  tfire('pointerdown', 2, 400, 450); step(30);
  tfire('pointerup', 1, 300, 450); tfire('pointerup', 2, 400, 450); step(30);
  check('accidental stroke discarded', w.landCount() === cells0 && app.input.undo.length === undoN, w.landCount() + ' vs ' + cells0);

  // erase tool
  app.input.setTool('del');
  const land1 = w.landCount();
  tfire('pointerdown', 1, 700, 450); tfire('pointermove', 1, 760, 450); tfire('pointerup', 1, 760, 450); step(60);
  check('touch erase', w.landCount() < land1, land1 + ' -> ' + w.landCount());
  check('tool button state', toolBtns.find((b) => b.dataset.tool === 'del').classList.contains('on'));

  // look tool rotates with one finger
  app.input.setTool('look');
  const yaw2 = app.rig.gyaw, land2 = w.landCount();
  tfire('pointerdown', 1, 500, 400); tfire('pointermove', 1, 560, 420); tfire('pointerup', 1, 560, 420); step(5);
  check('look tool rotates', app.rig.gyaw !== yaw2 && w.landCount() === land2);

  // brush slider
  elems.brushSlider.value = '4';
  (listeners['brushSlider:input'] || []).forEach((f) => f({}));
  check('brush slider', Math.abs(app.input.radius - 4) < 1e-6 && elems.brushVal.textContent === '4.0', app.input.radius);
  // fold button
  (listeners['fold:click'] || []).forEach((f) => f({}));
  check('fold toggles panel', elems.ctl.classList.contains('open'));
  // portrait framing fits the island width
  win.innerWidth = 390; win.innerHeight = 844;
  (listeners['window:resize'] || []).forEach((f) => f({})); app.randomIsland(); step(30);
  const b = w.islandBounds(), tanH = Math.tan(app.camera.fov * Math.PI / 360) * app.camera.aspect;
  check('portrait aspect', app.camera.aspect < 0.5 && app.camera.fov > 45, app.camera.aspect.toFixed(2));
  check('portrait island fits', app.rig.gdist >= (b.r + 3) / tanH - 0.01 || app.rig.gdist >= 92, 'dist ' + app.rig.gdist.toFixed(1) + ' need ' + ((b.r + 3) / tanH).toFixed(1));
  check('fog pushed back when zoomed out', app.scene.fog.near > 42, 'near ' + app.scene.fog.near.toFixed(0) + ' far ' + app.scene.fog.far.toFixed(0));
}
console.log('total frames', drawn.calls, ' pending', w.pending.size, ' active', w.active.size);
