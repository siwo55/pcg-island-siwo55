'use strict';
// Life: gulls, sailing boats and seasonal particles (petals / fireflies / leaves / snow).

// ---------------------------------------------------------------------------- birds
class Birds {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.flocks = [];
    const rnd = Util.mulberry32(9001);
    const sizes = [4, 3, 3];
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
    for (let f = 0; f < sizes.length; f++) {
      const fl = {
        cx: 0, cz: 0, R: 7 + rnd() * 7, h: 5.5 + rnd() * 3, w: (0.16 + rnd() * 0.12) * (rnd() < 0.5 ? -1 : 1),
        ph: rnd() * 6.28, birds: [], off: [rnd() * 4, rnd() * 4],
      };
      for (let i = 0; i < sizes[f]; i++) {
        const geo = Birds.makeGeometry();
        const mesh = new THREE.Mesh(geo, this.mat);
        mesh.rotation.order = 'YXZ';
        mesh.scale.setScalar(1.15 + rnd() * 0.35);
        mesh.frustumCulled = false;
        scene.add(mesh);
        const side = i === 0 ? 0 : (i % 2 ? 1 : -1);
        fl.birds.push({ mesh, lag: i * 0.07, ox: side * (0.5 + i * 0.35), oy: (rnd() - 0.5) * 0.6, ph: rnd() * 6.28, fq: 5 + rnd() * 2.5, pos: geo.attributes.position });
      }
      this.flocks.push(fl);
    }
  }

  // bird faces +x; two wings whose tips are animated in update()
  static makeGeometry() {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(4 * 9);
    const c = new Float32Array(4 * 9);
    const W = [1, 1, 1], T = [0.62, 0.66, 0.72];
    // triangles: body top, body bottom, left wing, right wing (wing tips are greyer)
    const cols = [[W, W, W], [W, W, W], [W, W, T], [W, W, T]];
    for (let t = 0; t < 4; t++) for (let v = 0; v < 3; v++) { const k = cols[t][v]; c.set(k, t * 9 + v * 3); }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    Birds.pose(g.attributes.position, 0, 0);
    return g;
  }
  static pose(attr, flap, sweep) {
    const a = attr.array;
    const set = (i, x, y, z) => { a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z; };
    // body: a slim arrow
    set(0, 0.16, 0, 0); set(1, -0.1, 0.012, 0.03); set(2, -0.1, 0.012, -0.03);
    set(3, 0.16, 0, 0); set(4, -0.1, -0.012, -0.03); set(5, -0.1, -0.012, 0.03);
    // wings (tip goes up/down with flap and sweeps back)
    const ty = flap * 0.13, tx = -0.02 - sweep * 0.05;
    set(6, 0.06, 0.005, 0.02); set(7, -0.06, 0.005, 0.02); set(8, tx, ty, 0.24 - Math.abs(flap) * 0.05);
    set(9, 0.06, 0.005, -0.02); set(10, -0.06, 0.005, -0.02); set(11, tx, ty, -0.24 + Math.abs(flap) * 0.05);
    attr.needsUpdate = true;
  }

  update(t, dt, center, night, season) {
    const day = 1 - night;
    const visible = day > 0.25;
    const rn = center.r || 6;
    for (let f = 0; f < this.flocks.length; f++) {
      const fl = this.flocks[f];
      // flocks circle the island, drifting slowly with its centre
      fl.cx += (center.x - fl.cx) * Math.min(1, dt * 0.5);
      fl.cz += (center.z - fl.cz) * Math.min(1, dt * 0.5);
      const R = fl.R + rn * 0.5;
      for (let i = 0; i < fl.birds.length; i++) {
        const b = fl.birds[i];
        const on = visible && !(season === 'winter' && (f + i) % 2 === 1);
        b.mesh.visible = on;
        if (!on) continue;
        const a = fl.ph + (t - b.lag) * fl.w;
        const wob = Math.sin(t * 0.37 + fl.ph) * 1.6 + Math.sin(t * 0.91 + b.ph) * 0.3;
        const rr = R + wob;
        const px = fl.cx + Math.cos(a) * rr + Math.cos(a + 1.57) * b.ox * 0.4;
        const pz = fl.cz + Math.sin(a) * rr + Math.sin(a + 1.57) * b.ox * 0.4;
        const py = fl.h + Math.sin(t * 0.5 + fl.ph) * 0.8 + b.oy;
        b.mesh.position.set(px, py, pz);
        // heading along the circle
        const dir = fl.w > 0 ? 1 : -1;
        const hx = -Math.sin(a) * dir, hz = Math.cos(a) * dir;
        b.mesh.rotation.y = -Math.atan2(hz, hx);
        b.mesh.rotation.x = dir * 0.25;    // bank into the turn
        // flap for a while, then glide
        const glide = Util.smoothstep(0.1, 0.6, Math.sin(t * 0.45 + b.ph * 3.0));
        const flap = Math.sin(t * b.fq + b.ph) * (1 - glide) + 0.12 * glide + Math.sin(t * 1.3 + b.ph) * 0.05;
        Birds.pose(b.pos, flap, glide);
      }
    }
    this.mat.color.setScalar(0.35 + 0.65 * day);
  }
}

// ---------------------------------------------------------------------------- boats
class Boats {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.boats = [];
    const rnd = Util.mulberry32(31337);
    this.center = { x: 0, z: 0, r: 8 };
    this.recalc = 0;
    for (let i = 0; i < 3; i++) {
      const kind = i === 1 ? 'row' : 'sail';
      const geo = Builders.boatGeometry(1000 + i * 77, kind);
      const mesh = new THREE.Mesh(geo, world.matMain);
      mesh.rotation.order = 'YXZ';
      mesh.scale.setScalar(1.25);
      mesh.castShadow = true;
      const lamp = new THREE.Sprite(world.matHalo);
      lamp.position.set(0.02, kind === 'sail' ? 0.82 : 0.32, 0);
      lamp.scale.setScalar(0.5);
      mesh.add(lamp);
      scene.add(mesh);
      this.boats.push({
        mesh, x: 0, z: 0, h: 0, v: 0.5 + rnd() * 0.3, dir: i % 2 ? -1 : 1, orbit: 5.5 + i * 2.4 + rnd() * 1.5,
        ph: rnd() * 6, placed: false, angle: rnd() * 6.28,
      });
    }
  }

  place(b) {
    // start on the orbit ring at the first water spot
    const c = this.center;
    for (let k = 0; k < 40; k++) {
      const a = b.angle + k * 0.35;
      const R = c.r + b.orbit;
      const x = c.x + Math.cos(a) * R, z = c.z + Math.sin(a) * R;
      if (!this.world.isLandAt(x, z)) {
        b.x = x; b.z = z; b.h = Math.atan2(Math.cos(a) * b.dir, -Math.sin(a) * b.dir);
        b.placed = true; return;
      }
    }
    b.x = c.x + c.r + 12; b.z = c.z; b.h = 0; b.placed = true;
  }

  update(t, dt) {
    const w = this.world;
    this.recalc -= dt;
    if (this.recalc <= 0) {
      this.recalc = 1.5;
      const b = w.islandBounds();
      this.center.x = b.x; this.center.z = b.z; this.center.r = Math.min(b.r + 2, 16);
    }
    const c = this.center, maxR = w.grid.extent + 6;
    for (const b of this.boats) {
      if (!b.placed) this.place(b);
      // steer around the island on a ring, keep out of the shallows
      const dx = b.x - c.x, dz = b.z - c.z, d = Math.hypot(dx, dz) || 1;
      const R = Math.min(c.r + b.orbit, maxR - 2);
      const rx = dx / d, rz = dz / d;
      const tx = -rz * b.dir, tz = rx * b.dir;                 // tangent
      const pull = Util.clamp((R - d) * 0.35, -1, 1);          // towards the ring
      let vx = tx + rx * pull, vz = tz + rz * pull;
      let want = Math.atan2(vz, vx);
      // feelers
      const hit = (ang, L) => w.isLandAt(b.x + Math.cos(b.h + ang) * L, b.z + Math.sin(b.h + ang) * L);
      let turn = 0;
      const hc = hit(0, 1.7) || hit(0, 0.9), hl = hit(0.6, 1.4), hr = hit(-0.6, 1.4);
      if (hc) turn = !hr ? -1.8 : (!hl ? 1.8 : 1.8 * b.dir);
      else { if (hl) turn -= 1.2; if (hr) turn += 1.2; }
      let dh = want - b.h;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const rate = Util.clamp(dh * 1.2, -0.7, 0.7) + turn * 0.9;
      b.h += Util.clamp(rate, -1.4, 1.4) * dt;
      const sp = b.v * (turn !== 0 ? 0.6 : 1);
      const nx = b.x + Math.cos(b.h) * sp * dt, nz = b.z + Math.sin(b.h) * sp * dt;
      if (!w.isLandAt(nx, nz)) { b.x = nx; b.z = nz; } else b.h += dt * 2.5;
      // bob on the waves
      const e = 0.4;
      const wy = Env.wave(b.x, b.z, t);
      const wxp = Env.wave(b.x + e, b.z, t) - Env.wave(b.x - e, b.z, t);
      const wzp = Env.wave(b.x, b.z + e, t) - Env.wave(b.x, b.z - e, t);
      b.mesh.position.set(b.x, wy + 0.02, b.z);
      b.mesh.rotation.y = -b.h;
      // pitch along heading, roll across it
      const pitch = (wxp * Math.cos(b.h) + wzp * Math.sin(b.h)) / (2 * e);
      const roll = (-wxp * Math.sin(b.h) + wzp * Math.cos(b.h)) / (2 * e);
      b.mesh.rotation.z = Util.clamp(pitch, -0.3, 0.3) * 1.2;
      b.mesh.rotation.x = -Util.clamp(roll, -0.3, 0.3) * 1.2 + Math.sin(t * 1.2 + b.ph) * 0.02;
    }
  }
}

// ---------------------------------------------------------------------------- particles
class Particles {
  constructor(scene, renderer, camera) {
    this.renderer = renderer; this.camera = camera;
    const N = 1100, pos = new Float32Array(N * 3), rnd = new Float32Array(N * 4), R = Util.mulberry32(2024);
    for (let i = 0; i < N * 4; i++) rnd[i] = R();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: {
        uTime: { value: 0 }, uScale: { value: 600 }, uType: { value: 0 }, uAmount: { value: 0 }, uNight: { value: 0 },
        uWind: { value: 0.4 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(40, 13, 40) },
        uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() }, uColC: { value: new THREE.Color() },
        uDim: { value: 1 },
      },
      vertexShader: `
        attribute vec4 aRnd;
        uniform float uTime, uScale, uType, uAmount, uNight, uWind, uDim;
        uniform vec3 uCenter, uBox, uColA, uColB, uColC;
        varying float vAlpha; varying vec3 vCol; varying float vRot; varying float vTw;
        void main(){
          float t = uTime;
          vec3 base = aRnd.xyz * uBox;
          vec3 p = base;
          float size = 0.12;
          vRot = 0.0; vTw = 0.0;
          vec3 col = uColA;
          if (uType < 0.5) {               // petals
            p += vec3(t * (0.45 + uWind * 0.9) + sin(t * 1.2 + aRnd.w * 20.0) * 0.6, -t * (0.35 + aRnd.w * 0.3), sin(t * 0.9 + aRnd.x * 30.0) * 0.7 + t * 0.15);
            size = 0.11 + aRnd.w * 0.07;
            vRot = t * (1.5 + aRnd.w * 2.0) + aRnd.x * 6.28;
            col = mix(uColA, uColB, fract(aRnd.w * 7.0));
          } else if (uType < 1.5) {        // fireflies
            p += vec3(sin(t * 0.4 + aRnd.w * 30.0) * 1.6, 0.0, cos(t * 0.35 + aRnd.w * 20.0) * 1.6);
            size = 0.22;
            col = uColA;
            vTw = 0.5 + 0.5 * sin(t * (1.4 + aRnd.z * 2.0) + aRnd.w * 40.0);
          } else if (uType < 2.5) {        // autumn leaves
            p += vec3(t * (0.55 + uWind * 1.1) + sin(t * 1.7 + aRnd.w * 20.0) * 0.9, -t * (0.7 + aRnd.w * 0.5), cos(t * 1.3 + aRnd.x * 20.0) * 0.9);
            size = 0.15 + aRnd.w * 0.09;
            vRot = t * (2.0 + aRnd.w * 3.0) + aRnd.y * 6.28;
            float k = fract(aRnd.w * 5.0);
            col = k < 0.34 ? uColA : (k < 0.67 ? uColB : uColC);
          } else {                         // snow
            p += vec3(sin(t * 0.5 + aRnd.w * 30.0) * 0.5 + t * uWind * 0.6, -t * (0.55 + aRnd.w * 0.4), cos(t * 0.4 + aRnd.x * 30.0) * 0.5);
            size = 0.08 + aRnd.w * 0.06;
            col = uColA;
          }
          vec3 lo = uCenter - uBox * 0.5;
          vec3 w = mod(p - lo, uBox) + lo;
          if (uType > 0.5 && uType < 1.5) w.y = 0.7 + aRnd.y * 2.8 + sin(t * 0.6 + aRnd.w * 10.0) * 0.35;
          vec3 hb = uBox * 0.5;
          float fx = 1.0 - smoothstep(0.7, 1.0, abs(w.x - uCenter.x) / hb.x);
          float fz = 1.0 - smoothstep(0.7, 1.0, abs(w.z - uCenter.z) / hb.z);
          float fy = smoothstep(0.0, 0.7, w.y) * (1.0 - smoothstep(uBox.y - 1.5, uBox.y, w.y));
          float shown = step(aRnd.z, uAmount);
          vAlpha = fx * fz * fy * shown;
          vCol = col * uDim;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = max(2.0, size * uScale / max(0.1, -mv.z));
        }`,
      fragmentShader: `
        uniform float uType, uNight;
        varying float vAlpha; varying vec3 vCol; varying float vRot; varying float vTw;
        void main(){
          vec2 uv = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          vec2 r = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
          float m;
          float a = vAlpha;
          if (uType < 0.5) {
            m = 1.0 - smoothstep(0.3, 0.5, length(vec2(r.x * 1.5, r.y * 0.85)));
          } else if (uType < 1.5) {
            float d = length(uv);
            m = exp(-d * d * 26.0) * (0.35 + 0.65 * vTw);
            a *= smoothstep(0.35, 0.8, uNight);
          } else if (uType < 2.5) {
            m = 1.0 - smoothstep(0.3, 0.5, length(vec2(r.x * 2.1, r.y * 0.9)));
          } else {
            m = 1.0 - smoothstep(0.22, 0.5, length(uv));
          }
          float al = m * a;
          if (al < 0.01) discard;
          gl_FragColor = vec4(vCol, al);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.season = null;
    this.amount = 0;
    this.target = 0;
    this.setSeason('spring');
    this.amount = this.target;
  }

  setSeason(s) {
    if (s === this.season) return;
    this.season = s;
    const u = this.mat.uniforms;
    const set = (a, b, c) => { u.uColA.value.set(a); u.uColB.value.set(b === undefined ? a : b); u.uColC.value.set(c === undefined ? a : c); };
    switch (s) {
      case 'spring': u.uType.value = 0; set(0xf9c2d6, 0xffffff); this.target = 0.55; this.mat.blending = THREE.NormalBlending; break;
      case 'summer': u.uType.value = 1; set(0xe6ff6a); this.target = 0.2; this.mat.blending = THREE.AdditiveBlending; break;
      case 'autumn': u.uType.value = 2; set(0xe8742c, 0xf0a935, 0xc8402a); this.target = 0.5; this.mat.blending = THREE.NormalBlending; break;
      default: u.uType.value = 3; set(0xffffff); this.target = 1; this.mat.blending = THREE.NormalBlending;
    }
    this.amount = 0;   // the new season's particles fade in
    u.uBox.value.set(40, s === 'summer' ? 5 : 13, 40);
  }

  update(dt, clock, target, night, wind) {
    const u = this.mat.uniforms;
    this.amount += (this.target - this.amount) * Math.min(1, dt * 0.9);
    u.uAmount.value = this.amount;
    u.uTime.value = clock;
    u.uNight.value = night;
    u.uWind.value = wind;
    const box = u.uBox.value;
    u.uCenter.value.set(target.x, box.y * 0.5, target.z);
    // falling particles dim with the light; fireflies always glow
    u.uDim.value = this.season === 'summer' ? 1 : 0.4 + 0.6 * (1 - night);
    const h = this.renderer.domElement.height || 800;
    u.uScale.value = h / (2 * Math.tan(this.camera.fov * Math.PI / 360));
  }
}
