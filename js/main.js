'use strict';
// Entry point: wires world, environment, life, input, audio and the HUD together.
(function () {
  const $ = (id) => document.getElementById(id);
  const P = new URLSearchParams(location.search);
  const EN = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };

  function fail(err) {
    console.error(err);
    const el = $('load');
    el.classList.remove('hide');
    el.style.cssText += ';padding:24px;text-align:center;letter-spacing:0;font-size:15px;opacity:1;pointer-events:auto';
    el.textContent = '出错了：' + (err && err.message ? err.message : err);
  }

  try { init(); } catch (e) { fail(e); }

  function init() {
    const canvas = $('c');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1000);

    const gridSeed = P.has('grid') ? +P.get('grid') : 2024;
    const islandSeed = P.has('seed') ? +P.get('seed') : (Math.random() * 1e9) | 0;
    const grid = Grid.generate(gridSeed, 11, 2);
    const world = new World(scene, grid, islandSeed);
    const rig = new CameraRig(camera);
    const env = new Env(scene, renderer, camera, world);
    const birds = new Birds(scene, world);
    const boats = new Boats(scene, world);
    const particles = new Particles(scene, renderer, camera);
    const audio = new AudioFX();
    let quietUntil = 0;
    const quiet = (ms) => { quietUntil = performance.now() + ms; };

    // ---------------------------------------------------------------- season
    let season = P.get('season');
    if (!Palette.SEASONS.includes(season)) season = 'spring';
    world.season = season;
    env.setSeason(season); env.applySeasonInstant();
    particles.setSeason(season); particles.amount = particles.target;
    const seasonBtns = Array.from(document.querySelectorAll('button.season'));
    function markSeason() {
      seasonBtns.forEach((b) => b.classList.toggle('on', b.dataset.s === season));
      document.body.dataset.season = season;
    }
    markSeason();

    let toastTimer = 0;
    function toast(main, sub) {
      const t = $('toast');
      t.innerHTML = main + (sub ? '<small>' + sub + '</small>' : '');
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 900);
    }

    function setSeason(s) {
      if (s === season) return;
      season = s;
      world.setSeason(s); env.setSeason(s); particles.setSeason(s);
      markSeason();
      toast(Palette.NAMES[s], EN[s]);
      quiet(900);
      audio.seasonChime(s);
    }

    // ---------------------------------------------------------------- island helpers
    function focusIsland() {
      const b = world.islandBounds();
      rig.focus(b.x, b.z, b.r * 2.5 + 15);
    }
    function randomIsland() {
      input.remember();
      quiet(1400);
      world.randomIsland((Math.random() * 1e9) | 0);
      world.rezone({ origin: [0, 0] });
      focusIsland();
      audio.sparkle();
    }
    function clearIsland() {
      if (!world.landCount()) return;
      input.remember();
      quiet(1400);
      world.clear();
    }

    // ---------------------------------------------------------------- audio needs a user gesture
    let audioStarted = false;
    function startAudio() { if (!audioStarted) { audioStarted = true; audio.start(); } }
    window.addEventListener('pointerdown', startAudio);
    window.addEventListener('keydown', startAudio);

    const soundEl = $('sound');
    function toggleSound() {
      startAudio();
      const on = audio.toggle();
      soundEl.textContent = on ? '🔊' : '🔇';
      soundEl.classList.toggle('on2', !on);
    }

    const timeEl = $('time'), clockEl = $('clock'), pauseEl = $('pause'), speedEl = $('speed');
    function togglePause() { env.paused = !env.paused; pauseEl.textContent = env.paused ? '▶' : '⏸'; }

    // ---------------------------------------------------------------- input
    const input = new Input(canvas, camera, scene, world, rig, {
      onSeason: setSeason,
      onRandom: randomIsland,
      onMute: toggleSound,
      onPause: togglePause,
      onFocus: focusIsland,
      onBrush: showBrush,
      onHistory: () => quiet(900),
    });
    world.onPlace = () => { if (performance.now() > quietUntil) audio.place(); };
    world.onRemove = () => { if (performance.now() > quietUntil) audio.remove(); };

    // ---------------------------------------------------------------- HUD
    world.onChange = (s) => {
      $('sHouse').textContent = s.house; $('sTree').textContent = s.tree; $('sField').textContent = s.field; $('sLand').textContent = s.land;
    };
    function showBrush(r) {
      $('brushVal').textContent = r.toFixed(1);
      const px = Util.clamp(6 + r * 5.6, 8, 38);
      const c = $('brushCircle'); c.style.width = c.style.height = px + 'px';
    }
    showBrush(input.radius);

    seasonBtns.forEach((b) => b.addEventListener('click', () => { setSeason(b.dataset.s); b.blur(); }));
    let dragging = false;
    timeEl.addEventListener('input', () => { env.time = timeEl.value / 1000; });
    timeEl.addEventListener('pointerdown', () => { dragging = true; });
    window.addEventListener('pointerup', () => { dragging = false; });
    pauseEl.addEventListener('click', () => { togglePause(); pauseEl.blur(); });
    const SPEEDS = [1, 4, 14];
    let speedIdx = 0;
    speedEl.addEventListener('click', () => {
      speedIdx = (speedIdx + 1) % SPEEDS.length; env.speed = SPEEDS[speedIdx];
      speedEl.textContent = '速度 ×' + SPEEDS[speedIdx]; speedEl.blur();
    });
    soundEl.addEventListener('click', () => { toggleSound(); soundEl.blur(); });
    $('random').addEventListener('click', (e) => { randomIsland(); e.currentTarget.blur(); });
    $('clear').addEventListener('click', (e) => { clearIsland(); e.currentTarget.blur(); });
    const undoEl = $('undo'), redoEl = $('redo');
    undoEl.addEventListener('click', () => { input.doUndo(); undoEl.blur(); });
    redoEl.addEventListener('click', () => { input.doRedo(); redoEl.blur(); });

    // ---------------------------------------------------------------- resize
    function resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 1 ? 52 : 38;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    // ---------------------------------------------------------------- start
    world.randomIsland(islandSeed);
    world.rezone({ origin: [0, 0] });
    if (P.has('time')) env.time = +P.get('time');
    if (P.get('pause') === '1') { env.paused = true; pauseEl.textContent = '▶'; }
    if (P.has('speed')) env.speed = +P.get('speed');
    focusIsland();
    if (P.has('yaw')) rig.yaw = rig.gyaw = +P.get('yaw');
    if (P.has('pitch')) rig.pitch = rig.gpitch = +P.get('pitch');
    if (P.has('dist')) rig.dist = rig.gdist = +P.get('dist');
    if (P.get('shot') === '1') document.body.classList.add('shot');
    const dbg = $('dbg');
    if (P.has('debug')) dbg.style.display = 'block';

    // build every cell at once (for screenshots: no pop-in wave left in the picture)
    function settle() {
      let g = 0;
      world.time += 20;
      while ((world.pending.size || world.dirty) && g++ < 200) world.update(0.3, env.night, env.wind);
      world.update(2.0, env.night, env.wind);
    }
    if (P.get('instant') === '1') { rig.update(0); env.update(0, rig.t); settle(); }

    // ---------------------------------------------------------------- loop
    let last = performance.now(), audioT = 0, fpsAcc = 0, fpsN = 0, loaded = false, histState = '';
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      rig.update(dt);
      input.update();
      env.update(dt, rig.t);
      world.update(dt, env.night, env.wind);
      world.wind = env.wind;
      boats.update(env.clock, dt);
      birds.update(env.clock, dt, boats.center, env.night, env.season);
      particles.update(dt, env.clock, rig.t, env.night, env.wind);
      renderer.render(scene, camera);

      if (!dragging) timeEl.value = Math.round(env.time * 1000);
      const mins = Math.floor(env.time * 24 * 60);
      clockEl.textContent = String(Math.floor(mins / 60) % 24).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
      const hs = (input.undo.length ? 'u' : '') + (input.redo.length ? 'r' : '');
      if (hs !== histState) {
        histState = hs;
        undoEl.disabled = !input.undo.length; redoEl.disabled = !input.redo.length;
        undoEl.style.opacity = undoEl.disabled ? 0.45 : 1; redoEl.style.opacity = redoEl.disabled ? 0.45 : 1;
      }
      audioT += dt;
      if (audioT > 0.4) { audioT = 0; audio.setState(env.season, env.night, env.wind); }
      if (!loaded) { loaded = true; setTimeout(() => $('load').classList.add('hide'), 250); }
      if (dbg.style.display === 'block') {
        fpsAcc += dt; fpsN++;
        if (fpsAcc > 0.5) {
          const i = renderer.info.render;
          dbg.textContent = Math.round(fpsN / fpsAcc) + ' fps  calls ' + i.calls + '  tris ' + i.triangles + '  pending ' + world.pending.size;
          fpsAcc = 0; fpsN = 0;
        }
      }
    }
    requestAnimationFrame(frame);
    window.__app = { renderer, scene, camera, grid, world, rig, env, birds, boats, particles, audio, input, settle, setSeason, randomIsland };
  }
})();
