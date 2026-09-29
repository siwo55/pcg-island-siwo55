'use strict';
// Procedural builders: turn a cell descriptor into merged low-poly geometry.
// World units: a cell is roughly 0.8-0.95 wide, sea level is y = 0, land top is BASE_Y.
const Builders = (() => {
  const { MB, tint, mix, centroid, scalePoly, rotPoly, insetPoly, lerp2, bil, circle, rectAt } = Geo;
  const BASE_Y = 0.55, BEV = 0.09, INSET = 0.04, BOTTOM = -1.4, FH = 0.46;
  const SNOW = 0xf4f9fc, GLASS = 0x37546e;
  const P3 = (p, y) => [p[0], y, p[1]];
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function ensurePositive(P) {
    let a = 0;
    for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return a < 0 ? P.slice().reverse() : P;
  }

  // thin 3-sided stick between two 3D points
  function stick(mb, p0, p1, w0, w1, col) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(dy / l) > 0.9) { ux = 1; uy = 0; }
    let ax = dy * uz - dz * uy, ay = dz * ux - dx * uz, az = dx * uy - dy * ux;
    let al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
    let bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
    const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
    const r0 = [], r1 = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const ox = ax * ca + bx * sa, oy = ay * ca + by * sa, oz = az * ca + bz * sa;
      r0.push([p0[0] + ox * w0, p0[1] + oy * w0, p0[2] + oz * w0]);
      r1.push([p1[0] + ox * w1, p1[1] + oy * w1, p1[2] + oz * w1]);
    }
    for (let i = 0; i < 3; i++) { const j = (i + 1) % 3; mb.quad(r0[i], r1[i], r1[j], r0[j], col); }
  }

  // ---------------------------------------------------------------- ground
  function topColor(ctx, k) {
    const { desc, pal, rnd, winter } = ctx;
    const j = 0.95 + rnd() * 0.1;
    switch (desc.t) {
      case 'house': return tint(winter ? mix(Palette.path, SNOW, 0.6) : Palette.path, j * 0.96);
      case 'plaza': case 'plazaSub': case 'tower': case 'church': case 'windmill':
        return tint(winter ? mix(Palette.plaza[(k + desc.seed) % 3], SNOW, 0.45) : Palette.plaza[(k + desc.seed) % 3], j);
      case 'lighthouse': return tint(winter ? SNOW : Palette.rock[0], j);
      case 'beach': case 'dock': return tint(pal.sand, j);
      case 'field': return tint(winter ? SNOW : mix(pal.dirt, 0x000000, 0.1), j);
      case 'meadow': return tint(Util.pick(pal.meadow, rnd()), j);
      default: return tint(Util.pick(pal.grass, rnd()), j);
    }
  }

  function jitterOf(vid, k) {
    const a = Util.hash01(vid, k, 91) * Math.PI * 2, m = 0.02 + Util.hash01(vid, k, 17) * 0.1;
    return [Math.cos(a) * m, Math.sin(a) * m];
  }

  function ground(ctx) {
    const { mb, V, c, desc, pal, rnd, winter, cell } = ctx;
    const g = desc.g;
    const top = insetPoly(V, c, INSET);
    const cy = g + (rnd() - 0.5) * 0.03;
    const cols = [];
    for (let k = 0; k < 4; k++) {
      const col = topColor(ctx, k);
      cols.push(col);
      const a = top[k], b = top[(k + 1) % 4];
      mb.tri([c[0], cy, c[1]], [b[0], g, b[1]], [a[0], g, a[1]], col);
    }
    const soil = winter ? mix(pal.dirt, SNOW, 0.7) : pal.dirt;
    const rockA = Palette.rock[0], rockB = Palette.rock[1];
    for (let k = 0; k < 4; k++) {
      const A = V[k], B = V[(k + 1) % 4], a = top[k], b = top[(k + 1) % 4];
      const bev = tint(mix(cols[k], soil, 0.4), 0.82);
      mb.quad([A[0], g - BEV, A[1]], [a[0], g, a[1]], [b[0], g, b[1]], [B[0], g - BEV, B[1]], bev, cols[k], cols[k], bev);
      const lo = desc.low[k];
      if (lo === null || lo === undefined) continue;
      const yTop = g - BEV;
      if (lo > -1) {
        mb.wall(A, B, lo, yTop, tint(rockA, 0.85), tint(soil, 0.9));
        continue;
      }
      // sea-facing cliff: 4 rings with per-vertex jitter shared between neighbours
      const ys = [yTop, yTop - 0.2, -0.22, BOTTOM];
      const cs = [tint(soil, 0.85), tint(rockA, 1.0), tint(rockB, 0.8), 0x2c5b66];
      const ia = cell.v[k], ib = cell.v[(k + 1) % 4];
      const ring = (vid, P, r) => {
        if (r === 0) return P3(P, ys[0]);
        const jv = jitterOf(vid, r);
        const s = r === 3 ? 1.6 : 1;
        return [P[0] + jv[0] * s, ys[r], P[1] + jv[1] * s];
      };
      for (let r = 0; r < 3; r++) {
        const a0 = ring(ia, A, r + 1), b0 = ring(ib, B, r + 1), a1 = ring(ia, A, r), b1 = ring(ib, B, r);
        mb.quad(a0, a1, b1, b0, cs[r + 1], cs[r], cs[r], cs[r + 1]);
      }
    }
  }

  // ---------------------------------------------------------------- vegetation
  function scatter(ctx, n, minD, avoid) {
    const pts = [];
    for (let tries = 0; tries < n * 14 && pts.length < n; tries++) {
      const p = bil(ctx.V, 0.16 + ctx.rnd() * 0.68, 0.16 + ctx.rnd() * 0.68);
      if (avoid && avoid.some((a) => Math.hypot(a[0] - p[0], a[1] - p[1]) < a[2])) continue;
      if (pts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= minD)) pts.push(p);
    }
    return pts;
  }

  function bareTree(ctx, x, y, z, s) {
    const { mb, rnd } = ctx;
    const wood = tint(Util.pick(Palette.woods, rnd()), 0.9);
    stick(mb, [x, y, z], [x, y + 0.42 * s, z], 0.045 * s, 0.025 * s, wood);
    const nb = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < nb; i++) {
      const a = rnd() * 6.28, h0 = y + (0.22 + rnd() * 0.16) * s;
      const tip = [x + Math.cos(a) * 0.18 * s, h0 + (0.16 + rnd() * 0.1) * s, z + Math.sin(a) * 0.18 * s];
      stick(mb, [x, h0, z], tip, 0.022 * s, 0.008 * s, wood);
      mb.gem(tip[0], tip[1] + 0.005, tip[2], 0.03 * s, SNOW, 0.6);
    }
  }

  function tree(ctx, x, y, z, kind, s = 1) {
    const { mb, pal, rnd, winter } = ctx;
    const trunk = Util.pick(Palette.woods, rnd());
    if (kind === 'pine') {
      const gcol = tint(Util.pick(pal.pine, rnd()), 0.88 + rnd() * 0.24);
      mb.frustum(x, y, z, 0.05 * s, 0.038 * s, 0.16 * s, 5, trunk, trunk, rnd() * 6, false);
      const rot = rnd();
      for (let i = 0; i < 3; i++) {
        const r = (0.3 - i * 0.075) * s, h = (0.36 - i * 0.03) * s, yy = y + (0.11 + i * 0.19) * s;
        mb.cone(x, yy, z, r, h, 6, tint(gcol, 1 + i * 0.05), rot, winter ? 0.5 : 0);
      }
    } else if (kind === 'palm') {
      const wood = tint(0x9a7a52, 0.95);
      const lean = rnd() * 6.28, lx = Math.cos(lean) * 0.07 * s, lz = Math.sin(lean) * 0.07 * s;
      const p0 = [x, y, z], p1 = [x + lx, y + 0.24 * s, z + lz], p2 = [x + lx * 2.6, y + 0.5 * s, z + lz * 2.6];
      stick(mb, p0, p1, 0.05 * s, 0.04 * s, wood); stick(mb, p1, p2, 0.04 * s, 0.03 * s, tint(wood, 0.9));
      const frond = pal.bare ? 0xbfd0c4 : tint(0x4faa4a, 0.9 + rnd() * 0.2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 6.28 + rnd() * 0.4, dx = Math.cos(a), dz = Math.sin(a);
        const px = -dz, pz = dx, len = 0.3 * s;
        const tip = [p2[0] + dx * len, p2[1] - 0.09 * s, p2[2] + dz * len];
        const mid = [p2[0] + dx * len * 0.5, p2[1] + 0.05 * s, p2[2] + dz * len * 0.5];
        const w = 0.07 * s;
        mb.tri(p2, [mid[0] + px * w, mid[1], mid[2] + pz * w], tip, frond);
        mb.tri(p2, tip, [mid[0] - px * w, mid[1], mid[2] - pz * w], tint(frond, 0.9));
      }
      mb.gem(p2[0], p2[1] - 0.02, p2[2], 0.03 * s, 0x7a5a3a);
    } else { // round crowns
      if (pal.bare) { bareTree(ctx, x, y, z, s); return; }
      const blossomy = ctx.season === 'spring' && rnd() < 0.45;
      const cl = blossomy ? Util.pick(pal.blossom, rnd()) : Util.pick(pal.leaves, rnd());
      mb.frustum(x, y, z, 0.05 * s, 0.035 * s, 0.26 * s, 5, trunk, trunk, rnd() * 6, false);
      mb.blob(x, y + 0.38 * s, z, 0.21 * s, cl, rnd, 0.9);
      if (rnd() < 0.7) mb.blob(x + (rnd() - 0.5) * 0.16 * s, y + 0.5 * s, z + (rnd() - 0.5) * 0.16 * s, 0.14 * s, tint(cl, 1.08), rnd, 0.9);
    }
  }

  function bush(ctx, x, y, z, s = 1) {
    const { mb, pal, rnd } = ctx;
    mb.blob(x, y + 0.06 * s, z, 0.1 * s, Util.pick(pal.bush, rnd()), rnd, 0.75);
    if (ctx.season === 'autumn' && rnd() < 0.5) mb.gem(x + 0.05 * s, y + 0.1 * s, z, 0.02, 0xc8302a);
  }

  function flower(ctx, x, y, z) {
    const { mb, pal, rnd } = ctx;
    if (pal.snow) return;
    const col = Util.pick(pal.flowers, rnd()), h = 0.07 + rnd() * 0.05;
    stick(mb, [x, y, z], [x, y + h, z], 0.007, 0.005, 0x4e9a3e);
    mb.gem(x, y + h + 0.012, z, 0.03, col, 0.7);
  }

  function tuft(ctx, x, y, z) {
    const { mb, pal, rnd } = ctx;
    const col = tint(Util.pick(pal.grass, rnd()), 0.85);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + rnd(), h = 0.09 + rnd() * 0.05;
      const bx = Math.cos(a) * 0.02, bz = Math.sin(a) * 0.02;
      mb.tri([x + bx - 0.012, y, z + bz], [x + bx + 0.012, y, z + bz], [x + bx * 2.5, y + h, z + bz * 2.5], col);
    }
  }

  function rock(ctx, x, y, z, s = 1) {
    const { mb, rnd, winter } = ctx;
    const col = Util.pick(Palette.rock, rnd());
    mb.blob(x, y + 0.05 * s, z, 0.12 * s, col, rnd, 0.7, 0.22);
    if (winter) mb.blob(x, y + 0.1 * s, z, 0.075 * s, SNOW, rnd, 0.5, 0.15);
  }

  function lamp(ctx, x, y, z) {
    const { mb, gb, lamps } = ctx;
    stick(mb, [x, y, z], [x, y + 0.42, z], 0.014, 0.012, 0x3a3f46);
    mb.box(x, y + 0.42, z, 0.07, 0.02, 0.07, 0x3a3f46);
    gb.box(x, y + 0.44, z, 0.055, 0.07, 0.055, 0xffd478);
    mb.pyramid(rectAt(x, z, 0.04, 0.04), y + 0.51, [x, y + 0.56, z], 0x3a3f46);
    lamps.push([x, y + 0.47, z]);
  }

  // ---------------------------------------------------------------- houses
  function slopeQuad(ctx, a0, a1, b1, b0, col) {
    const { mb, winter } = ctx;
    if (!winter) { mb.quad(a0, b0, b1, a1, col); return; }
    const m0 = lerp3(a0, b0, 0.22), m1 = lerp3(a1, b1, 0.22);
    mb.quad(a0, m0, m1, a1, col);
    mb.quad(m0, b0, b1, m1, SNOW);
  }

  function gableRoof(ctx, F, y, roofCol, gableCol, over = 1.16, rise = 0.3) {
    const { mb, c, rnd } = ctx;
    let R = F;
    const l01 = Geo.polyLen(F, 0) + Geo.polyLen(F, 2), l12 = Geo.polyLen(F, 1) + Geo.polyLen(F, 3);
    if (l12 > l01) R = [F[1], F[2], F[3], F[0]];
    const E = scalePoly(R, c, over);
    const ye = y - 0.03, yr = ye + rise;
    const mA = lerp2(E[1], E[2], 0.5), mB = lerp2(E[3], E[0], 0.5);
    const rA = P3(mA, yr), rB = P3(mB, yr);
    const e = E.map((p) => P3(p, ye));
    const shade = 0.96 + rnd() * 0.08;
    slopeQuad(ctx, e[0], e[1], rA, rB, tint(roofCol, shade));
    slopeQuad(ctx, e[2], e[3], rB, rA, tint(roofCol, 2 - shade > 1.04 ? 1.04 : 2 - shade));
    mb.tri(e[1], rA, e[2], gableCol);
    mb.tri(e[3], rB, e[0], gableCol);
    return { rA, rB, e, ridgeY: yr };
  }

  function hipRoof(ctx, F, y, roofCol, over = 1.16, rise = 0.34) {
    const { mb, c } = ctx;
    const E = scalePoly(F, c, over), ye = y - 0.03;
    const apex = [c[0], ye + rise, c[1]];
    for (let i = 0; i < E.length; i++) {
      const a = P3(E[i], ye), b = P3(E[(i + 1) % E.length], ye);
      if (ctx.winter) {
        const m0 = lerp3(a, apex, 0.24), m1 = lerp3(b, apex, 0.24);
        mb.quad(a, m0, m1, b, roofCol);
        mb.tri(m0, apex, m1, SNOW);
      } else mb.tri(a, apex, b, roofCol);
    }
  }

  function walls(ctx, F, y0, nFloors, wallCol, doorEdge, opts = {}) {
    const { mb, gb, c, rnd } = ctx;
    const n = F.length, h = nFloors * FH;
    const trim = opts.trim || tint(wallCol, 0.72);
    for (let e = 0; e < n; e++) {
      const A = F[e], B = F[(e + 1) % n];
      mb.wall(A, B, y0, y0 + h, tint(wallCol, 0.88), wallCol);
      const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz);
      if (L < 0.2) continue;
      const ex = dx / L, ez = dz / L, nx = ez, nz = -ex; // outward normal
      const nWin = Math.max(1, Math.min(3, Math.floor(L / 0.3)));
      for (let f = 0; f < nFloors; f++) {
        const yb = y0 + f * FH;
        for (let i = 0; i < nWin; i++) {
          const t = (i + 0.5) / nWin, px = A[0] + dx * t, pz = A[1] + dz * t;
          const isDoor = f === 0 && e === doorEdge && i === ((nWin - 1) >> 1);
          const off = 0.006;
          const q = (hw, y0_, y1_, o) => [
            [px - ex * hw + nx * o, yb + y0_, pz - ez * hw + nz * o], [px - ex * hw + nx * o, yb + y1_, pz - ez * hw + nz * o],
            [px + ex * hw + nx * o, yb + y1_, pz + ez * hw + nz * o], [px + ex * hw + nx * o, yb + y0_, pz + ez * hw + nz * o]];
          if (isDoor) {
            const d = q(0.075, 0.0, 0.27, off), fr = q(0.095, 0.0, 0.3, off * 0.5);
            mb.quad(fr[0], fr[1], fr[2], fr[3], trim);
            mb.quad(d[0], d[1], d[2], d[3], Util.pick(Palette.woods, (i * 0.37 + e * 0.13) % 1));
            // small awning
            const aw = q(0.11, 0.3, 0.3, 0.09);
            mb.quad([aw[0][0] - nx * 0.09, yb + 0.3, aw[0][2] - nz * 0.09], [aw[0][0], yb + 0.3, aw[0][2]], [aw[3][0], yb + 0.3, aw[3][2]], [aw[3][0] - nx * 0.09, yb + 0.3, aw[3][2] - nz * 0.09], trim);
            continue;
          }
          const fr = q(0.075, 0.15, 0.37, off * 0.5), gl = q(0.06, 0.17, 0.35, off);
          mb.quad(fr[0], fr[1], fr[2], fr[3], opts.frame || 0xf6f1e6);
          if (rnd() < 0.68) gb.quad(gl[0], gl[1], gl[2], gl[3], 0xffd478);
          else mb.quad(gl[0], gl[1], gl[2], gl[3], GLASS);
          if (opts.shutters) {
            const sl = q(0.03, 0.16, 0.36, off), sh = 0.105;
            const s1 = [[gl[0][0] - ex * 0.04, gl[0][1], gl[0][2] - ez * 0.04], [gl[1][0] - ex * 0.04, gl[1][1], gl[1][2] - ez * 0.04], [gl[1][0] - ex * 0.09, gl[1][1], gl[1][2] - ez * 0.09], [gl[0][0] - ex * 0.09, gl[0][1], gl[0][2] - ez * 0.09]];
            const s2 = [[gl[3][0] + ex * 0.04, gl[3][1], gl[3][2] + ez * 0.04], [gl[2][0] + ex * 0.04, gl[2][1], gl[2][2] + ez * 0.04], [gl[2][0] + ex * 0.09, gl[2][1], gl[2][2] + ez * 0.09], [gl[3][0] + ex * 0.09, gl[3][1], gl[3][2] + ez * 0.09]];
            mb.quad(s1[0], s1[1], s1[2], s1[3], opts.shutters);
            mb.quad(s2[0], s2[1], s2[2], s2[3], opts.shutters);
          }
        }
      }
    }
    // floor band trims
    for (let f = 1; f < nFloors; f++) mb.prism(scalePoly(F, c, 1.02), y0 + f * FH - 0.018, y0 + f * FH + 0.018, trim, trim, false);
  }

  function houseCell(ctx) {
    const { mb, V, c, desc, rnd, winter } = ctx;
    const g = desc.g;
    const wallCol = Palette.walls[desc.wc], roofCol = Palette.roofs[desc.rc];
    const gableCol = tint(wallCol, 1.04);
    let F = scalePoly(V, c, 0.76 + rnd() * 0.06);
    const stone = tint(Palette.stone[desc.rc % 3], 0.9);
    mb.prism(scalePoly(F, c, 1.03), g, g + 0.09, stone, tint(stone, 1.08));
    let y = g + 0.09;
    const shut = rnd() < 0.55 ? Util.pick([0x2f7d6d, 0x6b4a30, 0x3d6fa8, 0x9a3b30], rnd()) : null;
    const opts = { shutters: shut };
    const fl = desc.fl, tiered = fl >= 3 && rnd() < 0.55;
    const n1 = tiered ? fl - 1 : fl;
    walls(ctx, F, y, n1, wallCol, desc.door, opts);
    y += n1 * FH;
    let topF = F;
    if (tiered) {
      const E = scalePoly(F, c, 1.13), Fu = scalePoly(F, c, 0.7);
      ctx.mb.loft(E, y - 0.03, Fu, y + 0.17, tint(roofCol, 0.95), tint(roofCol, winter ? 1 : 1.05));
      if (winter) mb.loft(scalePoly(E, c, 0.86), y + 0.02, Fu, y + 0.17, SNOW);
      y += 0.17;
      walls(ctx, Fu, y, 1, Palette.walls[(desc.wc + 3) % Palette.walls.length], -1, opts);
      y += FH; topF = Fu;
    }
    let chimPos = null;
    if (desc.roof === 'hip') {
      hipRoof(ctx, topF, y, roofCol, 1.16, 0.32 + rnd() * 0.12);
      chimPos = [c[0] + (rnd() - 0.5) * 0.14, y + 0.08, c[1] + (rnd() - 0.5) * 0.14];
    } else {
      const r = gableRoof(ctx, topF, y, roofCol, gableCol, 1.16, 0.26 + rnd() * 0.16);
      const t = 0.25 + rnd() * 0.5;
      chimPos = [r.rA[0] + (r.rB[0] - r.rA[0]) * t, r.ridgeY - 0.12, r.rA[2] + (r.rB[2] - r.rA[2]) * t];
    }
    if (desc.chim) {
      const [x, cy, z] = chimPos;
      mb.box(x, cy, z, 0.08, 0.25, 0.08, 0x9a5a48, 0, 0x7a4638);
      if (winter) mb.box(x, cy + 0.25, z, 0.09, 0.02, 0.09, SNOW);
      ctx.anims.push({ type: 'smoke', pos: [x, cy + 0.27, z] });
    }
    // barrels / crates by the wall
    if (rnd() < 0.35) {
      const p = bil(V, 0.9, 0.1);
      mb.frustum(p[0] * 0.5 + c[0] * 0.5, g, p[1] * 0.5 + c[1] * 0.5, 0.045, 0.045, 0.08, 6, 0x8b6642, 0x9a7650, 0, true);
    }
    if (rnd() < 0.3) { const p = scatter(ctx, 1, 0.2)[0]; if (p) tree(ctx, (p[0] + c[0]) / 2 * 0 + p[0], g, p[1], 'round', 0.55); }
  }

  function gardenCell(ctx) {
    const { mb, V, c, desc, rnd, pal, winter } = ctx;
    const g = desc.g;
    // hedge boxes on two sides + beds
    const hedge = tint(Util.pick(pal.bush, rnd()), 0.85);
    const F = scalePoly(V, c, 0.86);
    const e = Math.floor(rnd() * 4);
    for (const k of [e, (e + 2) % 4]) {
      const A = F[k], B = F[(k + 1) % 4];
      const pts = [lerp2(A, B, 0.06), lerp2(A, B, 0.94)];
      const dx = pts[1][0] - pts[0][0], dz = pts[1][1] - pts[0][1], L = Math.hypot(dx, dz);
      const nx = dz / L * 0.045, nz = -dx / L * 0.045;
      const H = ensurePositive([[pts[0][0] - nx, pts[0][1] - nz], [pts[1][0] - nx, pts[1][1] - nz], [pts[1][0] + nx, pts[1][1] + nz], [pts[0][0] + nx, pts[0][1] + nz]]);
      mb.prism(H, g, g + 0.1, tint(hedge, 0.9), hedge);
      if (winter) mb.cap(H, g + 0.1, SNOW);
    }
    const trees = scatter(ctx, 1, 0.3);
    for (const p of trees) tree(ctx, p[0], g, p[1], rnd() < 0.5 ? 'round' : 'pine', 0.7 + rnd() * 0.3);
    const bed = scatter(ctx, 5, 0.14, trees.map((t) => [t[0], t[1], 0.2]));
    for (const p of bed) { if (rnd() < 0.7) flower(ctx, p[0], g, p[1]); else bush(ctx, p[0], g, p[1], 0.8); }
    if (rnd() < 0.4) { // bench
      const p = bil(V, 0.5, 0.5);
      mb.box(p[0], g + 0.06, p[1], 0.2, 0.025, 0.07, 0x8b6642, Math.atan2(V[1][1] - V[0][1], V[1][0] - V[0][0]));
      mb.box(p[0], g, p[1], 0.18, 0.06, 0.05, 0x5a4230, Math.atan2(V[1][1] - V[0][1], V[1][0] - V[0][0]));
    }
  }

  function plazaCell(ctx) {
    const { mb, gb, V, c, desc, rnd, winter, pal } = ctx;
    const g = desc.g;
    const kind = desc.pv;
    if (kind === 0) { // fountain
      const s0 = circle(c[0], c[1], 0.27, 8), s1 = circle(c[0], c[1], 0.2, 8);
      const stone = 0xc9c3b6;
      mb.loft(s0, g, s0, g + 0.11, tint(stone, 0.9), stone);
      mb.loft(s1, g + 0.11, s1, g + 0.05, tint(stone, 0.8), tint(stone, 0.8));
      mb.cap(s1, g + 0.05, winter ? 0xdff0f8 : 0x5cc6dc);
      stick(mb, [c[0], g, c[1]], [c[0], g + 0.3, c[1]], 0.04, 0.03, stone);
      mb.cone(c[0], g + 0.26, c[1], 0.11, 0.05, 8, stone);
      if (!winter) ctx.anims.push({ type: 'spray', pos: [c[0], g + 0.31, c[1]] });
    } else if (kind === 1) { // market stall
      const rot = Math.atan2(V[1][1] - V[0][1], V[1][0] - V[0][0]);
      const cols = Util.pick([[0xd9584a, 0xf6f1e4], [0x3f86bf, 0xf6f1e4], [0xf0c15a, 0xf6f1e4], [0x53b3b0, 0xf6f1e4]], rnd());
      const w = 0.44, d = 0.3;
      mb.box(c[0], g, c[1], w, 0.18, d, 0x8b6642, rot, 0x9a7650);
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const at = (lx, lz, y) => [c[0] + lx * cs - lz * sn, y, c[1] + lx * sn + lz * cs];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) stick(mb, at(sx * w * 0.46, sz * d * 0.46, g + 0.18), at(sx * w * 0.46, sz * d * 0.46, g + 0.5), 0.012, 0.012, 0x6b4a30);
      const ns = 6;
      for (let i = 0; i < ns; i++) {
        const x0 = -w * 0.55 + (i / ns) * w * 1.1, x1 = -w * 0.55 + ((i + 1) / ns) * w * 1.1;
        const col = i % 2 ? cols[0] : cols[1];
        mb.quad(at(x0, -d * 0.6, g + 0.46), at(x0, d * 0.6, g + 0.46), at(x1, d * 0.6, g + 0.46), at(x1, -d * 0.6, g + 0.46), col);
        mb.quad(at(x0, -d * 0.6, g + 0.46), at(x1, -d * 0.6, g + 0.46), at(x1, -d * 0.6 - 0.04, g + 0.41), at(x0, -d * 0.6 - 0.04, g + 0.41), col);
      }
      if (winter) mb.cap(rectAt(c[0], c[1], w * 0.55, d * 0.6, rot), g + 0.465, SNOW);
      for (let i = 0; i < 4; i++) { const p = at(-w * 0.3 + i * 0.2, 0, g + 0.2); mb.blob(p[0], p[1], p[2], 0.04, Util.pick([0xd9584a, 0xf0c15a, 0x7fbf6a], rnd()), rnd, 1, 0.1); }
    } else if (kind === 2) { // well
      const s0 = circle(c[0], c[1], 0.15, 8);
      mb.loft(s0, g, s0, g + 0.16, 0x9a9488, 0xb7b0a4);
      mb.cap(circle(c[0], c[1], 0.11, 8), g + 0.15, 0x2a4a5a);
      stick(mb, [c[0] - 0.15, g + 0.16, c[1]], [c[0] - 0.15, g + 0.42, c[1]], 0.014, 0.014, 0x6b4a30);
      stick(mb, [c[0] + 0.15, g + 0.16, c[1]], [c[0] + 0.15, g + 0.42, c[1]], 0.014, 0.014, 0x6b4a30);
      mb.pyramid(rectAt(c[0], c[1], 0.22, 0.13), g + 0.4, [c[0], g + 0.55, c[1]], 0xd2633a);
    } else { // tree in a stone planter + benches
      const s0 = circle(c[0], c[1], 0.2, 8);
      mb.loft(s0, g, s0, g + 0.07, 0x9a9488, 0xb7b0a4);
      mb.cap(s0, g + 0.07, winter ? SNOW : 0x6a5238);
      tree(ctx, c[0], g + 0.07, c[1], 'round', 1.1);
    }
    // corner lamps
    const lc = desc.lamps;
    for (let i = 0; i < 4; i++) if ((lc >> i) & 1) { const p = lerp2(V[i], c, 0.32); lamp(ctx, p[0], g, p[1]); }
  }

  function plazaSubCell(ctx) {
    const { V, c, desc, rnd, mb } = ctx;
    if (rnd() < 0.45) { const i = Math.floor(rnd() * 4); const p = lerp2(V[i], c, 0.3); lamp(ctx, p[0], desc.g, p[1]); }
    else if (rnd() < 0.5) { const p = bil(V, 0.5, 0.5); const bs = ctx.winter ? SNOW : Util.pick(ctx.pal.flowers, rnd()); flower(ctx, p[0], desc.g, p[1]); }
  }

  function fieldCell(ctx) {
    const { mb, V, c, desc, rnd, pal, winter, season } = ctx;
    const g = desc.g;
    const strips = 5, ridgeH = 0.035;
    const c0 = Util.pick(pal.field, rnd()), c1 = tint(c0, 0.86);
    const swap = desc.rot;
    const pt = (u, v) => { const p = swap ? bil(V, v, u) : bil(V, u, v); return p; };
    const m = 0.1;
    for (let i = 0; i < strips; i++) {
      const u0 = m + (i / strips) * (1 - 2 * m), u1 = m + ((i + 0.72) / strips) * (1 - 2 * m);
      const P = ensurePositive([pt(u0, m), pt(u1, m), pt(u1, 1 - m), pt(u0, 1 - m)]);
      const col = i % 2 ? c0 : c1;
      mb.prism(P, g, g + ridgeH, tint(col, 0.75), col);
      if (!winter && season !== 'spring' && rnd() < 0.9) { // crops
        const nc = 4;
        for (let j = 0; j < nc; j++) {
          const p = lerp2(lerp2(P[0], P[1], 0.5), lerp2(P[3], P[2], 0.5), (j + 0.5) / nc);
          if (season === 'summer') mb.gem(p[0], g + ridgeH + 0.05, p[1], 0.035, 0xe8c840, 2.2);
          else if (rnd() < 0.5) mb.blob(p[0], g + ridgeH + 0.03, p[1], 0.04, 0xe2762a, rnd, 0.8, 0.1);
          else mb.gem(p[0], g + ridgeH + 0.04, p[1], 0.03, 0xc9a04a, 1.6);
        }
      } else if (!winter) {
        const p = lerp2(lerp2(P[0], P[1], 0.5), lerp2(P[3], P[2], 0.5), 0.5);
        for (let j = 0; j < 5; j++) tuft(ctx, lerp2(P[0], P[3], j / 4)[0] * 0.5 + lerp2(P[1], P[2], j / 4)[0] * 0.5, g + ridgeH, lerp2(P[0], P[3], j / 4)[1] * 0.5 + lerp2(P[1], P[2], j / 4)[1] * 0.5);
      }
    }
    if (rnd() < 0.4) { // scarecrow
      const p = bil(V, 0.5, 0.5);
      stick(mb, [p[0], g, p[1]], [p[0], g + 0.3, p[1]], 0.012, 0.012, 0x6b4a30);
      stick(mb, [p[0] - 0.09, g + 0.22, p[1]], [p[0] + 0.09, g + 0.22, p[1]], 0.01, 0.01, 0x6b4a30);
      mb.blob(p[0], g + 0.33, p[1], 0.035, 0xe8c99a, rnd, 1, 0.05);
      mb.cone(p[0], g + 0.34, p[1], 0.05, 0.05, 5, 0x8b6642);
    }
    if (rnd() < 0.3 && season === 'autumn') { const p = bil(V, 0.15, 0.85); mb.frustum(p[0], g, p[1], 0.06, 0.06, 0.1, 7, 0xd9b34a, 0xe6c860); }
  }

  function forestCell(ctx) {
    const { desc, V, rnd, pal, winter } = ctx;
    const g = desc.g;
    const n = desc.n;
    const pts = scatter(ctx, n, 0.27);
    const pineBias = desc.pine;
    for (const p of pts) {
      const kind = rnd() < pineBias ? 'pine' : 'round';
      tree(ctx, p[0], g, p[1], kind, 0.85 + rnd() * 0.45);
    }
    for (const p of scatter(ctx, 2, 0.2, pts.map((q) => [q[0], q[1], 0.18]))) {
      if (rnd() < 0.5) bush(ctx, p[0], g, p[1], 0.8); else if (rnd() < 0.5) rock(ctx, p[0], g, p[1], 0.7); else tuft(ctx, p[0], g, p[1]);
    }
    if (ctx.season === 'autumn' && rnd() < 0.4) { const p = bil(V, 0.5, 0.5); mb_mush(ctx, p[0], g, p[1]); }
  }
  function mb_mush(ctx, x, y, z) {
    ctx.mb.cone(x, y + 0.035, z, 0.04, 0.03, 6, 0xd9432f);
    ctx.mb.frustum(x, y, z, 0.012, 0.012, 0.04, 5, 0xf1e8d8, 0xf1e8d8, 0, false);
  }

  function meadowCell(ctx) {
    const { desc, rnd, winter } = ctx;
    const g = desc.g;
    const trees = rnd() < desc.tp ? scatter(ctx, 1 + (rnd() < 0.3 ? 1 : 0), 0.32) : [];
    for (const p of trees) tree(ctx, p[0], g, p[1], rnd() < 0.3 ? 'pine' : 'round', 0.8 + rnd() * 0.4);
    const av = trees.map((q) => [q[0], q[1], 0.2]);
    for (const p of scatter(ctx, winter ? 1 : 6, 0.13, av)) {
      const r = rnd();
      if (r < 0.45) flower(ctx, p[0], g, p[1]); else if (r < 0.75) tuft(ctx, p[0], g, p[1]); else if (r < 0.9) bush(ctx, p[0], g, p[1]); else rock(ctx, p[0], g, p[1], 0.6);
    }
  }

  function beachCell(ctx) {
    const { desc, rnd, V, mb, season } = ctx;
    const g = desc.g;
    const av = [];
    if (rnd() < desc.tp) { const p = scatter(ctx, 1, 0.3)[0]; if (p) { tree(ctx, p[0], g, p[1], 'palm', 0.9 + rnd() * 0.4); av.push([p[0], p[1], 0.2]); } }
    for (const p of scatter(ctx, 2, 0.15, av)) {
      const r = rnd();
      if (r < 0.4) rock(ctx, p[0], g, p[1], 0.5); else if (r < 0.7) tuft(ctx, p[0], g, p[1]); else mb.gem(p[0], g + 0.012, p[1], 0.025, 0xf6c7d0, 0.4);
    }
    if (season === 'summer' && rnd() < 0.3) { // umbrella
      const p = bil(V, 0.5, 0.5);
      stick(mb, [p[0], g, p[1]], [p[0], g + 0.34, p[1]], 0.012, 0.012, 0xf1e8d8);
      const cols = Util.pick([[0xd9584a, 0xf6f1e4], [0x3f86bf, 0xf6f1e4]], rnd());
      const R = circle(p[0], p[1], 0.2, 8);
      for (let i = 0; i < 8; i++) mb.tri(P3(R[i], g + 0.3), [p[0], g + 0.4, p[1]], P3(R[(i + 1) % 8], g + 0.3), cols[i % 2]);
      mb.box(p[0] + 0.2, g, p[1] + 0.05, 0.22, 0.012, 0.11, 0xf0c15a, rnd() * 3);
    }
  }

  function rocksCell(ctx) {
    const { desc, rnd } = ctx;
    const g = desc.g;
    const n = 2 + Math.floor(rnd() * 3);
    for (const p of scatter(ctx, n, 0.2)) rock(ctx, p[0], g, p[1], 0.9 + rnd() * 1.1);
    for (const p of scatter(ctx, 2, 0.2)) { if (rnd() < 0.5) bush(ctx, p[0], g, p[1], 0.7); else tuft(ctx, p[0], g, p[1]); }
  }

  // ---------------------------------------------------------------- boats & dock
  function boatGeometry(seed, kind) {
    const rnd = Util.mulberry32(seed);
    const mb = new MB();
    const hull = Util.pick([0x8b5a3a, 0xf1e8d8, 0x2f6fa8, 0xc9483c, 0x3b8c7a], rnd());
    const trim = 0xf6f1e4;
    const deck = ensurePositive([[-0.3, -0.11], [0.16, -0.13], [0.36, 0], [0.16, 0.13], [-0.3, 0.11]]);
    const keel = deck.map((p) => [p[0] * 0.7, p[1] * 0.45]);
    mb.loft(keel, -0.04, deck, 0.11, tint(hull, 0.7), hull);
    mb.cap(deck, 0.09, 0xb98f5c);
    mb.loft(deck, 0.11, scalePoly(deck, [0, 0], 0.93), 0.12, trim);
    if (kind === 'sail') {
      const sail = Util.pick([0xf6f1e4, 0xf6f1e4, 0xe8b04a, 0xd9584a, 0x9ad0e0], rnd());
      stick(mb, [0.02, 0.09, 0], [0.02, 0.72, 0], 0.016, 0.01, 0x6b4a30);
      mb.tri([0.02, 0.16, 0], [0.02, 0.7, 0], [-0.26, 0.17, 0], sail);
      mb.tri([0.02, 0.16, 0], [-0.26, 0.17, 0], [0.02, 0.7, 0], tint(sail, 0.9));
      mb.tri([0.05, 0.16, 0], [0.05, 0.6, 0], [0.32, 0.14, 0], tint(sail, 0.95));
      mb.tri([0.05, 0.16, 0], [0.32, 0.14, 0], [0.05, 0.6, 0], tint(sail, 0.85));
      mb.tri([0.02, 0.72, 0], [0.02, 0.8, 0], [-0.08, 0.76, 0], 0xd9584a);
    } else {
      mb.box(-0.1, 0.1, 0, 0.16, 0.13, 0.15, 0xf1e8d8, 0, 0xd2633a);
      stick(mb, [0.12, 0.1, 0.08], [0.12, 0.3, 0.08], 0.01, 0.01, 0x6b4a30);
    }
    return mb.build();
  }

  function dockCell(ctx) {
    const { mb, V, c, desc, rnd, winter, cell } = ctx;
    const g = desc.g;
    // beach dressing
    for (const p of scatter(ctx, 1, 0.2)) rock(ctx, p[0], g, p[1], 0.5);
    const k = desc.dk;
    const A = V[k], B = V[(k + 1) % 4];
    const m = lerp2(A, B, 0.5);
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz) || 1;
    const ex = dx / L, ez = dz / L, nx = ez, nz = -ex; // outward
    const len = 1.45, hw = 0.16, top = g - 0.04;
    const p0 = [m[0] - nx * 0.15, m[1] - nz * 0.15];
    const ang = Math.atan2(nz, nx);
    const wood = 0x9a7650, wood2 = 0x86643f;
    const planks = 8;
    for (let i = 0; i < planks; i++) {
      const t0 = i / planks * len, t1 = (i + 0.9) / planks * len;
      const P = ensurePositive([[p0[0] + nx * t0 - ex * hw, p0[1] + nz * t0 - ez * hw], [p0[0] + nx * t1 - ex * hw, p0[1] + nz * t1 - ez * hw], [p0[0] + nx * t1 + ex * hw, p0[1] + nz * t1 + ez * hw], [p0[0] + nx * t0 + ex * hw, p0[1] + nz * t0 + ez * hw]]);
      mb.prism(P, top - 0.03, top, i % 2 ? wood : wood2, i % 2 ? wood : wood2);
      if (winter) mb.cap(P, top + 0.001, SNOW);
    }
    for (const t of [0.15, 0.55, 0.95, 1.4]) for (const s of [-1, 1]) {
      const x = p0[0] + nx * t + ex * hw * s, z = p0[1] + nz * t + ez * hw * s;
      stick(mb, [x, -0.5, z], [x, top + 0.08, z], 0.028, 0.026, 0x5a4230);
    }
    const bx = p0[0] + nx * (len - 0.2) + ex * (hw + 0.28), bz = p0[1] + nz * (len - 0.2) + ez * (hw + 0.28);
    ctx.anims.push({ type: 'moored', pos: [bx, 0.02, bz], heading: ang + (rnd() - 0.5) * 0.3, seed: desc.seed, kind: rnd() < 0.5 ? 'sail' : 'row' });
    ctx.lamp = null;
    lamp(ctx, p0[0] + nx * (len - 0.05) - ex * hw, top, p0[1] + nz * (len - 0.05) - ez * hw);
  }

  // ---------------------------------------------------------------- landmarks
  function stoneBase(ctx, s, h) {
    const { mb, V, c, desc } = ctx;
    const B = scalePoly(V, c, s);
    mb.prism(B, desc.g, desc.g + h, 0x9a9488, 0xb9b2a3);
    if (ctx.winter) mb.cap(B, desc.g + h + 0.001, SNOW);
    return desc.g + h;
  }

  function towerCell(ctx) {
    const { mb, gb, V, c, desc, rnd, winter } = ctx;
    const sc = desc.sc;
    let y = stoneBase(ctx, sc * 1.02, 0.14);
    const wallC = 0xf4efe4, roofC = Palette.roofs[desc.rc];
    const F = scalePoly(V, c, sc * 0.78);
    const tiers = desc.tiers;
    let S = 1, rot = 0;
    let P = F;
    for (let i = 0; i < tiers; i++) {
      P = rotPoly(scalePoly(F, c, S), c, rot);
      const h = 0.82 + rnd() * 0.3;
      walls(ctx, P, y, 1, wallC, i === 0 ? desc.door : -1, { trim: 0xd8cfbc, shutters: i % 2 ? 0x3d6fa8 : null });
      // extend wall to full tier height beyond one floor
      mb.loft(P, y + FH, P, y + h, wallC, wallC);
      if (i === 0) { // arched entrance on 1 edge
        const A = P[desc.door % 4], B = P[(desc.door + 1) % 4];
        const mid = lerp2(A, B, 0.5), dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), ex = dx / L, ez = dz / L;
        const nx = ez, nz = -ex;
        const q = (hw, y0, y1, o) => [[mid[0] - ex * hw + nx * o, y + y0, mid[1] - ez * hw + nz * o], [mid[0] - ex * hw + nx * o, y + y1, mid[1] - ez * hw + nz * o], [mid[0] + ex * hw + nx * o, y + y1, mid[1] + ez * hw + nz * o], [mid[0] + ex * hw + nx * o, y + y0, mid[1] + ez * hw + nz * o]];
        const a = q(0.11, 0, 0.3, 0.012);
        mb.quad(a[0], a[1], a[2], a[3], 0x5a4230);
        mb.tri(a[1], [mid[0] + nx * 0.012, y + 0.4, mid[1] + nz * 0.012], a[2], 0x5a4230);
      }
      y += h;
      const last = i === tiers - 1;
      const nextS = S * 0.8, nextRot = rot + (rnd() - 0.5) * 0.55;
      const E = scalePoly(P, c, 1.14);
      if (!last) {
        const Q = rotPoly(scalePoly(F, c, nextS), c, nextRot);
        mb.loft(E, y - 0.03, Q, y + 0.24, tint(roofC, 0.95), roofC);
        if (winter) mb.loft(scalePoly(E, c, 0.8), y + 0.03, Q, y + 0.24, SNOW);
        y += 0.24;
      }
      S = nextS; rot = nextRot;
    }
    // spire
    const E = scalePoly(P, c, 1.2), ye = y - 0.03;
    const apex = [c[0], ye + 1.15, c[1]];
    for (let i = 0; i < 4; i++) {
      const a = P3(E[i], ye), b = P3(E[(i + 1) % 4], ye);
      if (winter) { const m0 = lerp3(a, apex, 0.3), m1 = lerp3(b, apex, 0.3); mb.quad(a, m0, m1, b, roofC); mb.tri(m0, apex, m1, SNOW); } else mb.tri(a, apex, b, roofC, tint(roofC, 1.12), roofC);
    }
    stick(mb, apex, [apex[0], apex[1] + 0.4, apex[2]], 0.012, 0.008, 0x4a4038);
    mb.tri([apex[0], apex[1] + 0.4, apex[2]], [apex[0], apex[1] + 0.3, apex[2]], [apex[0] + 0.2, apex[1] + 0.35, apex[2]], 0xd9584a);
    mb.tri([apex[0], apex[1] + 0.4, apex[2]], [apex[0] + 0.2, apex[1] + 0.35, apex[2]], [apex[0], apex[1] + 0.3, apex[2]], 0xd9584a);
    // garden around
    for (let i = 0; i < 4; i++) { const p = lerp2(V[i], c, 0.15); if (rnd() < 0.7) tree(ctx, p[0], desc.g, p[1], rnd() < 0.5 ? 'round' : 'pine', 0.75); }
  }

  function churchCell(ctx) {
    const { mb, gb, V, c, desc, rnd, winter } = ctx;
    const g = desc.g, sc = desc.sc;
    let y = stoneBase(ctx, sc * 1.0, 0.12);
    const wallC = 0xf6f1e6, roofC = Palette.roofs[desc.rc];
    const F = scalePoly(V, c, sc * 0.62);
    walls(ctx, F, y, 2, wallC, desc.door, { trim: 0xd8cfbc, frame: 0xe8e0cc });
    gableRoof(ctx, F, y + 2 * FH, roofC, wallC, 1.14, 0.42);
    // bell tower at vertex 0
    const tp = lerp2(V[0], c, 0.32);
    const rot = Math.atan2(V[1][1] - V[0][1], V[1][0] - V[0][0]);
    const T = rectAt(tp[0], tp[1], 0.17, 0.17, rot);
    const th = 3 * FH + 0.5;
    mb.loft(T, y, T, y + th, tint(wallC, 0.9), wallC);
    for (let e = 0; e < 4; e++) {
      const A = T[e], B = T[(e + 1) % 4], mid = lerp2(A, B, 0.5), dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), ex = dx / L, ez = dz / L, nx = ez, nz = -ex;
      const a = [[mid[0] - ex * 0.05 + nx * 0.006, y + th - 0.32, mid[1] - ez * 0.05 + nz * 0.006], [mid[0] - ex * 0.05 + nx * 0.006, y + th - 0.1, mid[1] - ez * 0.05 + nz * 0.006], [mid[0] + ex * 0.05 + nx * 0.006, y + th - 0.1, mid[1] + ez * 0.05 + nz * 0.006], [mid[0] + ex * 0.05 + nx * 0.006, y + th - 0.32, mid[1] + ez * 0.05 + nz * 0.006]];
      mb.quad(a[0], a[1], a[2], a[3], 0x3a3f46);
      // clock on the lower band
      if (e < 2) { const cg = [[mid[0] - ex * 0.06 + nx * 0.008, y + th - 0.6, mid[1] - ez * 0.06 + nz * 0.008], [mid[0] - ex * 0.06 + nx * 0.008, y + th - 0.48, mid[1] - ez * 0.06 + nz * 0.008], [mid[0] + ex * 0.06 + nx * 0.008, y + th - 0.48, mid[1] + ez * 0.06 + nz * 0.008], [mid[0] + ex * 0.06 + nx * 0.008, y + th - 0.6, mid[1] + ez * 0.06 + nz * 0.008]]; gb.quad(cg[0], cg[1], cg[2], cg[3], 0xffd478); }
    }
    const spireC = Util.pick([0x4f8f8a, 0x556a86, 0xb84a2e], rnd());
    const E = scalePoly(T, tp, 1.18), apex = [tp[0], y + th + 1.0, tp[1]];
    for (let i = 0; i < 4; i++) {
      const a = P3(E[i], y + th - 0.02), b = P3(E[(i + 1) % 4], y + th - 0.02);
      if (winter) { const m0 = lerp3(a, apex, 0.3), m1 = lerp3(b, apex, 0.3); mb.quad(a, m0, m1, b, spireC); mb.tri(m0, apex, m1, SNOW); } else mb.tri(a, apex, b, spireC);
    }
    stick(mb, apex, [apex[0], apex[1] + 0.22, apex[2]], 0.01, 0.01, 0xe8c04a);
    stick(mb, [apex[0] - 0.05, apex[1] + 0.15, apex[2]], [apex[0] + 0.05, apex[1] + 0.15, apex[2]], 0.008, 0.008, 0xe8c04a);
    for (const i of [2, 3]) { const p = lerp2(V[i], c, 0.22); tree(ctx, p[0], g, p[1], rnd() < 0.5 ? 'round' : 'pine', 0.75); }
    ctx.anims.push({ type: 'bell', pos: [tp[0], y + th - 0.2, tp[1]] });
  }

  function windmillCell(ctx) {
    const { mb, gb, V, c, desc, rnd, winter } = ctx;
    const g = desc.g;
    let y = stoneBase(ctx, desc.sc, 0.1);
    const heading = desc.heading;
    const H = 2.0, r0 = 0.5 * Math.min(1.2, desc.sc), r1 = r0 * 0.66;
    const wallC = 0xf1e8d6;
    mb.frustum(c[0], y, c[1], r0 * 1.06, r0 * 1.02, 0.28, 8, 0x9a9488, 0xa9a397, 0, false);
    mb.frustum(c[0], y + 0.28, c[1], r0, r1, H - 0.28, 8, tint(wallC, 0.92), wallC, 0, false);
    // door + windows
    const hx = Math.cos(heading), hz = Math.sin(heading);
    const doorP = [c[0] - hx * (r0 * 0.98), c[1] - hz * (r0 * 0.98)];
    const d = [[doorP[0] - hz * 0.08, y + 0.02, doorP[1] + hx * 0.08], [doorP[0] - hz * 0.08, y + 0.32, doorP[1] + hx * 0.08], [doorP[0] + hz * 0.08, y + 0.32, doorP[1] - hx * 0.08], [doorP[0] + hz * 0.08, y + 0.02, doorP[1] - hx * 0.08]];
    mb.quad(d[0], d[1], d[2], d[3], 0x6b4a30);
    for (let i = 0; i < 3; i++) {
      const a = heading + Math.PI + (i - 1) * 1.5 + 0.7, wy = y + 0.8 + i * 0.35;
      const wx = c[0] + Math.cos(a) * (r0 - (wy - y) / H * (r0 - r1) - 0.02) , wz = c[1] + Math.sin(a) * (r0 - (wy - y) / H * (r0 - r1) - 0.02);
      const tx = -Math.sin(a) * 0.05, tz = Math.cos(a) * 0.05;
      gb.quad([wx - tx, wy, wz - tz], [wx - tx, wy + 0.14, wz - tz], [wx + tx, wy + 0.14, wz + tz], [wx + tx, wy, wz + tz], 0xffd478);
    }
    // cap
    const capC = Util.pick([0xb84a2e, 0x8f4a35, 0x556a86], rnd());
    const top = y + H;
    const R = circle(c[0], c[1], r1 * 1.22, 8);
    const apex = [c[0], top + 0.55, c[1]];
    for (let i = 0; i < 8; i++) {
      const a = P3(R[i], top - 0.02), b = P3(R[(i + 1) % 8], top - 0.02);
      if (winter) { const m0 = lerp3(a, apex, 0.35), m1 = lerp3(b, apex, 0.35); mb.quad(a, m0, m1, b, capC); mb.tri(m0, apex, m1, SNOW); } else mb.tri(a, apex, b, capC);
    }
    // blades (animated, built in local space, axis = +x pointing forward)
    const bm = new MB();
    const sailC = 0xf6f1e4, spar = 0x6b4a30;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const arm = (l, w, z) => [0, ca * l - sa * w, sa * l + ca * w].map((v, k) => (k === 0 ? z : v));
      const P0 = [0.0, 0, 0];
      const q = (l, w) => [0.02, ca * l + (-sa) * w, sa * l + ca * w];
      stick(bm, [0.02, 0, 0], q(1.12, 0), 0.02, 0.014, spar);
      const s0 = q(0.22, 0.03), s1 = q(1.08, 0.03), s2 = q(1.08, 0.3), s3 = q(0.22, 0.3);
      bm.quad(s0, s1, s2, s3, sailC);
      bm.quad(s0, s3, s2, s1, tint(sailC, 0.9));
      stick(bm, q(0.22, 0.3), q(1.08, 0.3), 0.008, 0.008, spar);
    }
    bm.gem(0.04, 0, 0, 0.07, 0x4a4038, 1);
    ctx.anims.push({ type: 'windmill', pos: [c[0] + hx * (r1 * 1.3), top - 0.18, c[1] + hz * (r1 * 1.3)], heading, geo: bm.build(), speed: 0.6 + rnd() * 0.5 });
    for (let i = 0; i < 4; i++) if (rnd() < 0.6) { const p = lerp2(V[i], c, 0.16); if (Math.hypot(p[0] - c[0], p[1] - c[1]) > r0 + 0.1) bush(ctx, p[0], g, p[1], 0.9); }
  }

  function lighthouseCell(ctx) {
    const { mb, gb, V, c, desc, rnd, winter } = ctx;
    const g = desc.g;
    // rocky plinth
    const B = scalePoly(V, c, 1.12);
    mb.prism(B, g, g + 0.16, 0x7d8085, 0x9a9da2);
    if (winter) mb.cap(B, g + 0.161, SNOW);
    let y = g + 0.16;
    const H = 3.0, r0 = 0.36, r1 = 0.24, bands = 4;
    for (let i = 0; i < bands; i++) {
      const ra = r0 + (r1 - r0) * (i / bands), rb = r0 + (r1 - r0) * ((i + 1) / bands), h = H / bands;
      const col = i % 2 ? 0xd9483c : 0xf6f1e6;
      mb.frustum(c[0], y + i * h, c[1], ra, rb, h, 8, tint(col, 0.9), col, 0.2, false);
    }
    const top = y + H;
    // gallery
    const gr = circle(c[0], c[1], r1 * 1.55, 8, 0.2), gt = circle(c[0], c[1], r1 * 1.4, 8, 0.2);
    mb.loft(gt, top - 0.05, gr, top + 0.02, 0x3a3f46);
    mb.loft(gr, top + 0.02, gr, top + 0.06, 0x3a3f46);
    mb.cap(gr, top + 0.06, 0x4a4f56);
    // lantern room
    const lr = circle(c[0], c[1], r1 * 0.8, 8, 0.2);
    gb.loft(lr, top + 0.06, lr, top + 0.36, 0xffd478);
    for (let i = 0; i < 8; i++) { const a = 0.2 + (i / 8) * Math.PI * 2; stick(mb, [c[0] + Math.cos(a) * r1 * 0.8, top + 0.06, c[1] + Math.sin(a) * r1 * 0.8], [c[0] + Math.cos(a) * r1 * 0.8, top + 0.36, c[1] + Math.sin(a) * r1 * 0.8], 0.012, 0.012, 0x3a3f46); }
    const rc = circle(c[0], c[1], r1 * 1.05, 8, 0.2);
    mb.loft(rc, top + 0.34, circle(c[0], c[1], r1 * 0.2, 8, 0.2), top + 0.6, 0xd9483c);
    mb.cap(circle(c[0], c[1], r1 * 0.2, 8, 0.2), top + 0.6, 0xd9483c);
    mb.gem(c[0], top + 0.66, c[1], 0.04, 0x3a3f46);
    // little door + windows
    const dd = desc.door % 4, A = V[dd], Bv = V[(dd + 1) % 4];
    ctx.anims.push({ type: 'beam', pos: [c[0], top + 0.21, c[1]], phase: rnd() * 6 });
    ctx.lamps.push([c[0], top + 0.21, c[1], 2.4]);
    for (const p of scatter(ctx, 2, 0.25, [[c[0], c[1], r0 + 0.1]])) rock(ctx, p[0], g + 0.16, p[1], 0.9);
  }

  const BY_TYPE = {
    house: houseCell, garden: gardenCell, plaza: plazaCell, plazaSub: plazaSubCell, field: fieldCell, forest: forestCell,
    meadow: meadowCell, beach: beachCell, rocks: rocksCell, dock: dockCell, tower: towerCell, church: churchCell,
    windmill: windmillCell, lighthouse: lighthouseCell,
  };

  function build(grid, cell, desc, season) {
    const pal = Palette.S[season];
    const V = cell.v.map((i) => grid.verts[i]);
    const c = [cell.cx, cell.cz];
    const ctx = {
      grid, cell, desc, pal, season, winter: season === 'winter', V, c,
      rnd: Util.mulberry32(desc.seed), mb: new MB(), gb: new MB(), lamps: [], anims: [],
    };
    ground(ctx);
    (BY_TYPE[desc.t] || meadowCell)(ctx);
    const oy = BOTTOM;
    const loc = (p) => [p[0] - c[0], p[1] - oy, p[2] - c[1]];
    return {
      main: ctx.mb.build(c[0], oy, c[1]),
      glow: ctx.gb.build(c[0], oy, c[1]),
      lamps: ctx.lamps.map((l) => loc(l).concat(l[3] || 1)),
      anims: ctx.anims.map((a) => Object.assign({}, a, { pos: loc(a.pos) })),
      origin: [c[0], oy, c[1]],
    };
  }

  return { build, boatGeometry, BASE_Y, BOTTOM, BEV, FH, stick };
})();
