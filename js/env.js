'use strict';
// Environment: sky, sea, sun/moon lighting, day-night cycle, stars, clouds.
// (Birds, boats and seasonal particles live in life.js.)
class Env {
  constructor(scene, renderer, camera, world) {
    this.scene = scene; this.renderer = renderer; this.camera = camera; this.world = world;
    this.time = 0.36;            // 0..1, 0.25 sunrise, 0.5 noon, 0.75 sunset
    this.paused = false;
    this.speed = 1;
    this.dayLen = 240;           // seconds for one full day at speed 1
    this.season = 'spring';
    this.night = 0;              // 0 day .. 1 deep night (drives windows, halos, stars, birds)
    this.wind = 0.4;
    this.clock = 0;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);

    const pal = Palette.S[this.season];
    // colours that ease towards the season's values
    this.cur = {
      deep: new THREE.Color(pal.sea.deep), shallow: new THREE.Color(pal.sea.shallow), foam: new THREE.Color(pal.sea.foam),
      tint: new THREE.Color(pal.skyTint), tintAmt: pal.skyTintAmt, cloud: new THREE.Color(pal.cloud), mul: new THREE.Color(Env.SEASON_MUL.spring),
    };
    this.S = { top: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), hSky: new THREE.Color(), hGnd: new THREE.Color(), sunI: 1, hI: 1, night: 0 };
    this.tmp = new THREE.Color();

    this.buildLights();
    this.buildSky();
    this.buildStars();
    this.buildWater();
    this.buildClouds();

    scene.fog = new THREE.Fog(0xbfe6f5, 42, 125);
    this.applySeasonInstant();
    this.update(0, new THREE.Vector3());
  }

  // ------------------------------------------------------------------ setup
  buildLights() {
    const sc = this.scene, ext = this.world.grid.extent;
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(2048, 2048);
    const r = ext * 0.72;
    Object.assign(s.camera, { left: -r, right: r, top: r, bottom: -r, near: 5, far: 200 });
    s.camera.updateProjectionMatrix();
    s.bias = -0.0006; s.normalBias = 0.03; s.radius = 2.2;
    sc.add(this.sun); sc.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfe1ff, 0x8fae80, 1.4);
    sc.add(this.hemi);
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(100, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uBot: { value: new THREE.Color() },
        uSunDir: { value: this.sunDir }, uSunCol: { value: new THREE.Color() }, uNight: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main(){
          vDir = position;
          gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
        }`,
      fragmentShader: `
        uniform vec3 uTop, uHor, uBot, uSunCol, uSunDir;
        uniform float uNight;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHor, uTop, pow(clamp(h, 0.0, 1.0), 0.5));
          col = mix(col, uBot, smoothstep(0.0, -0.3, h));
          float sd = max(dot(d, uSunDir), 0.0);
          float day = 1.0 - uNight;
          col += uSunCol * (pow(sd, 6.0) * 0.16 + pow(sd, 64.0) * 0.3) * day * (1.0 - clamp(h, 0.0, 1.0) * 0.6);
          col += vec3(1.0, 0.97, 0.85) * smoothstep(0.9994, 0.9998, sd) * 2.0 * day;
          float md = max(dot(d, -uSunDir), 0.0);
          col += vec3(0.85, 0.9, 1.0) * pow(md, 40.0) * 0.12 * uNight;
          col += vec3(0.96, 0.95, 0.88) * smoothstep(0.9990, 0.9994, md) * 1.6 * uNight;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.frustumCulled = false; this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  buildStars() {
    const n = 700, p = new Float32Array(n * 3), rnd = Util.mulberry32(77);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, y = 0.06 + Math.pow(rnd(), 0.8) * 0.94, r = Math.sqrt(1 - y * y);
      p[i * 3] = Math.cos(a) * r * 300; p[i * 3 + 1] = y * 300; p[i * 3 + 2] = Math.sin(a) * r * 300;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false; this.stars.renderOrder = -9;
    this.scene.add(this.stars);
  }

  buildWater() {
    const size = 300, segs = 200;
    this.waterStep = size / segs;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const w = this.world;
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uExtent: { value: w.maskExtent },
        uNear: { value: w.texNear }, uFar: { value: w.texFar },
        uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uFoamCol: { value: new THREE.Color() },
        uAmb: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uLightDir: { value: this.lightDir },
        uSkyHor: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uFogNear: { value: 42 }, uFogFar: { value: 125 },
        uWaveAmp: { value: 1 },
      },
      vertexShader: `
        uniform float uTime, uWaveAmp;
        varying vec3 vWorld;
        ${Env.WAVE_GLSL}
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          w.y += waveH(w.xz, uTime) * uWaveAmp;
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uTime, uExtent, uFogNear, uFogFar;
        uniform sampler2D uNear, uFar;
        uniform vec3 uDeep, uShallow, uFoamCol, uAmb, uSun, uLightDir, uSkyHor, uFog;
        varying vec3 vWorld;
        void main(){
          vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          if (n.y < 0.0) n = -n;
          n = normalize(vec3(n.x * 2.6, n.y, n.z * 2.6));
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 L = normalize(uLightDir);
          float t = uTime;

          vec2 uv = (vWorld.xz + uExtent) / (2.0 * uExtent);
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          float nearM = texture2D(uNear, uv).r * inside;
          float farM = texture2D(uFar, uv).r * inside;

          float shallow = smoothstep(0.02, 0.55, farM);
          vec3 base = mix(uDeep, uShallow, shallow);
          float ndl = max(dot(n, L), 0.0);
          vec3 col = base * (uAmb + uSun * ndl) * 1.12;

          // caustic-like glints in the shallows
          float sp = sin(vWorld.x * 7.3 + t * 1.7 + sin(vWorld.z * 3.1) * 2.0) * sin(vWorld.z * 6.9 - t * 1.3 + sin(vWorld.x * 2.7) * 2.0);
          col += uSun * smoothstep(0.82, 1.0, sp) * 0.10 * shallow;

          // sun / moon glitter
          vec3 H = normalize(L + V);
          col += uSun * pow(max(dot(n, H), 0.0), 110.0) * 0.9;

          // grazing angles reflect the sky
          float fr = pow(1.0 - max(dot(n, V), 0.0), 4.0);
          col = mix(col, uSkyHor * (uAmb + uSun * 0.35) * 1.1, fr * 0.5);

          // foam: a lapping band at the coast plus lines drifting towards the shore
          float thr = 0.17 + 0.13 * sin(t * 0.8 + vWorld.x * 0.35 + vWorld.z * 0.27);
          float brk = 0.05 * sin(vWorld.x * 5.0 + t * 1.3) * sin(vWorld.z * 5.5 - t);
          float foam = smoothstep(thr - 0.05, thr + 0.01, nearM + brk);
          float lines = smoothstep(0.93, 1.0, sin(farM * 10.0 - t * 1.4)) * smoothstep(0.06, 0.22, farM) * smoothstep(0.85, 0.55, farM) * 0.4;
          vec3 foamLit = uFoamCol * min(vec3(1.0), (uAmb + uSun * 0.6) * 1.35);
          col = mix(col, foamLit, clamp(foam + lines, 0.0, 1.0) * inside);

          float d = length(vWorld - cameraPosition);
          col = mix(col, uFog, smoothstep(uFogNear, uFogFar, d));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.water = new THREE.Mesh(geo, this.waterMat);
    this.water.frustumCulled = false;
    this.water.renderOrder = -1;
    this.scene.add(this.water);
  }

  buildClouds() {
    const shapes = [];
    for (let s = 0; s < 6; s++) {
      const rnd = Util.mulberry32(500 + s * 31), mb = new Geo.MB();
      const n = 4 + Math.floor(rnd() * 4), len = 1.6 + rnd() * 1.6;
      for (let i = 0; i < n; i++) {
        const u = n === 1 ? 0 : i / (n - 1) - 0.5;
        const r = (0.75 + rnd() * 0.6) * (1 - Math.abs(u) * 0.9);
        mb.blob(u * len * 2, r * 0.25 + (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.8, r, 0xffffff, rnd, 0.62, 0.14, 0.05);
      }
      shapes.push(mb.build());
    }
    this.cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.clouds = [];
    const rnd = Util.mulberry32(4242);
    for (let i = 0; i < 11; i++) {
      const m = new THREE.Mesh(shapes[i % shapes.length], this.cloudMat);
      const sc = 1.3 + rnd() * 1.4;
      m.scale.set(sc * (1 + rnd() * 0.5), sc * (0.8 + rnd() * 0.4), sc);
      m.position.set((rnd() - 0.5) * 180, 10 + rnd() * 5, (rnd() - 0.5) * 100);
      m.rotation.y = (rnd() - 0.5) * 0.5;
      m.castShadow = i % 2 === 0;
      m.userData = { v: 0.35 + rnd() * 0.5, y0: m.position.y, ph: rnd() * 6 };
      this.scene.add(m); this.clouds.push(m);
    }
  }

  // ------------------------------------------------------------------ seasons
  setSeason(season) {
    this.season = season;
    this.pal = Palette.S[season];
  }
  applySeasonInstant() {
    const p = Palette.S[this.season], c = this.cur;
    c.deep.set(p.sea.deep); c.shallow.set(p.sea.shallow); c.foam.set(p.sea.foam);
    c.tint.set(p.skyTint); c.tintAmt = p.skyTintAmt; c.cloud.set(p.cloud); c.mul.set(Env.SEASON_MUL[this.season]);
  }
  ease(dt) {
    const p = Palette.S[this.season], c = this.cur, k = 1 - Math.exp(-dt * 2.2);
    const T = this.tmp;
    c.deep.lerp(T.set(p.sea.deep), k); c.shallow.lerp(T.set(p.sea.shallow), k); c.foam.lerp(T.set(p.sea.foam), k);
    c.tint.lerp(T.set(p.skyTint), k); c.tintAmt += (p.skyTintAmt - c.tintAmt) * k;
    c.cloud.lerp(T.set(p.cloud), k); c.mul.lerp(T.set(Env.SEASON_MUL[this.season]), k);
  }

  // ------------------------------------------------------------------ time of day
  sampleKeys(t) {
    const K = Env.KEYS, n = K.length;
    let i = 0;
    while (i < n - 2 && t >= K[i + 1].t) i++;
    const a = K[i], b = K[i + 1];
    const u = Util.smoothstep(0, 1, (t - a.t) / (b.t - a.t));
    const S = this.S;
    S.top.copy(a.top).lerp(b.top, u); S.hor.copy(a.hor).lerp(b.hor, u); S.sun.copy(a.sun).lerp(b.sun, u);
    S.hSky.copy(a.hSky).lerp(b.hSky, u); S.hGnd.copy(a.hGnd).lerp(b.hGnd, u);
    S.sunI = Util.lerp(a.sunI, b.sunI, u); S.hI = Util.lerp(a.hI, b.hI, u); S.night = Util.lerp(a.night, b.night, u);
  }

  update(dt, target) {
    this.clock += dt;
    if (!this.paused) this.time = (this.time + dt * this.speed / this.dayLen) % 1;
    this.ease(dt);
    const t = this.time, S = this.S, c = this.cur;
    this.sampleKeys(t);
    this.night = S.night;
    const day = 1 - S.night;

    // sun / moon position
    const th = (t - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(th) * 0.85, Math.sin(th), 0.45).normalize();
    const elev = this.sunDir.y;
    const sunW = Util.smoothstep(-0.12, 0.08, elev);
    const ld = this.lightDir;
    ld.set(
      Util.lerp(-this.sunDir.x, this.sunDir.x, sunW),
      Util.lerp(-this.sunDir.y, this.sunDir.y, sunW),
      Util.lerp(-this.sunDir.z, this.sunDir.z, sunW)
    );
    ld.y = Math.max(ld.y, 0.24); ld.normalize();

    // seasonal grading of light and sky
    S.sun.multiply(c.mul);
    S.hSky.multiply(c.mul);
    S.hor.lerp(c.tint, c.tintAmt * (0.35 + 0.65 * day));
    S.top.lerp(c.tint, c.tintAmt * 0.25 * day);

    const focus = this.snapTarget(target);
    this.sun.color.copy(S.sun);
    this.sun.intensity = S.sunI * (this.season === 'winter' ? 0.94 : 1);
    this.sun.position.set(focus.x + ld.x * 90, ld.y * 90, focus.z + ld.z * 90);
    this.sun.target.position.set(focus.x, 0, focus.z);
    this.hemi.color.copy(S.hSky); this.hemi.groundColor.copy(S.hGnd); this.hemi.intensity = S.hI;

    // sky + fog
    const su = this.skyMat.uniforms;
    su.uTop.value.copy(S.top); su.uHor.value.copy(S.hor);
    su.uBot.value.copy(S.hor).lerp(this.tmp.copy(S.top), 0.25).multiplyScalar(0.8);
    su.uSunCol.value.copy(S.sun); su.uNight.value = Util.clamp(S.night * 1.1, 0, 1);
    this.sky.position.copy(this.camera.position);
    this.stars.position.copy(this.camera.position);
    this.starMat.opacity = Util.smoothstep(0.55, 0.95, S.night);
    this.scene.fog.color.copy(S.hor);
    this.renderer.setClearColor(S.hor, 1);

    // water
    const wu = this.waterMat.uniforms;
    wu.uTime.value = this.clock;
    wu.uDeep.value.copy(c.deep); wu.uShallow.value.copy(c.shallow); wu.uFoamCol.value.copy(c.foam);
    wu.uAmb.value.copy(S.hSky).lerp(S.hGnd, 0.15).multiplyScalar(S.hI / Math.PI);
    wu.uSun.value.copy(S.sun).multiplyScalar(S.sunI / Math.PI);
    wu.uSkyHor.value.copy(S.hor); wu.uFog.value.copy(S.hor);
    this.water.position.set(focus.x, 0, focus.z);

    // wind: slow gusts around a seasonal base
    const base = { spring: 0.5, summer: 0.3, autumn: 0.75, winter: 0.8 }[this.season];
    this.wind = Util.clamp(base + 0.3 * Math.sin(this.clock * 0.13) * Math.sin(this.clock * 0.31 + 1.0), 0, 1);

    // clouds
    this.cloudMat.color.copy(c.cloud);
    this.cloudMat.emissive.copy(c.cloud).multiplyScalar(0.06 * day);
    for (const m of this.clouds) {
      const u = m.userData;
      m.position.x += u.v * (0.5 + this.wind) * dt;
      if (m.position.x > 100) m.position.x = -100;
      m.position.y = u.y0 + Math.sin(this.clock * 0.15 + u.ph) * 0.25;
    }
  }

  // keeps the sea mesh vertices on a fixed world lattice so the facets do not shimmer
  snapTarget(target) {
    const s = this.waterStep;
    this._f = this._f || new THREE.Vector3();
    this._f.set(Math.round(target.x / s) * s, 0, Math.round(target.z / s) * s);
    return this._f;
  }

  // the same wave function as the vertex shader (boats bob with it)
  static wave(x, z, t) {
    return 0.05 * Math.sin(x * 0.9 + t * 1.1) + 0.04 * Math.sin(z * 1.2 - t * 0.9 + x * 0.3) + 0.03 * Math.sin((x + z) * 1.7 + t * 1.7);
  }
}

Env.WAVE_GLSL = `
  float waveH(vec2 p, float t){
    return 0.05 * sin(p.x * 0.9 + t * 1.1) + 0.04 * sin(p.y * 1.2 - t * 0.9 + p.x * 0.3) + 0.03 * sin((p.x + p.y) * 1.7 + t * 1.7);
  }`;

Env.SEASON_MUL = { spring: 0xffffff, summer: 0xfffaf0, autumn: 0xffe8d0, winter: 0xeaf2ff };

// Day-night keyframes. t: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
Env.KEYS = (() => {
  const K = (t, top, hor, sun, sunI, hSky, hGnd, hI, night) => ({
    t, top: new THREE.Color(top), hor: new THREE.Color(hor), sun: new THREE.Color(sun), sunI,
    hSky: new THREE.Color(hSky), hGnd: new THREE.Color(hGnd), hI, night,
  });
  return [
    K(0.00, 0x060c24, 0x1a2c52, 0x7d92d6, 0.60, 0x3a4f8f, 0x121a2c, 1.00, 1.00),
    K(0.20, 0x0d1a40, 0x2f4470, 0x7d92d6, 0.55, 0x3a4f8f, 0x141a2a, 0.95, 0.97),
    K(0.25, 0x3c5686, 0xf2a373, 0xffa668, 1.30, 0x8494c0, 0x4a3c3c, 1.00, 0.55),
    K(0.32, 0x5aa0dc, 0xffddb8, 0xffe4bd, 2.05, 0xb0d2f5, 0x7f9a70, 1.25, 0.08),
    K(0.50, 0x3d8be0, 0xbfe6f5, 0xfff4e2, 2.40, 0xc4e2ff, 0x8fae80, 1.45, 0.00),
    K(0.68, 0x4a90d8, 0xd2e9f0, 0xffefd2, 2.20, 0xbcdcf7, 0x88a578, 1.35, 0.00),
    K(0.75, 0x5b6fb2, 0xffa878, 0xff9a5a, 1.30, 0xa392c4, 0x5a4038, 1.00, 0.45),
    K(0.81, 0x1f2c62, 0xc46b80, 0x8f80b8, 0.70, 0x4d5c9c, 0x1c1828, 0.92, 0.90),
    K(1.00, 0x060c24, 0x1a2c52, 0x7d92d6, 0.60, 0x3a4f8f, 0x121a2c, 1.00, 1.00),
  ];
})();
