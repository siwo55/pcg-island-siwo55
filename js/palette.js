'use strict';
// Seasonal palettes. Colors are hex numbers.
const Palette = (() => {
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const NAMES = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };

  // Shared across seasons (the town itself does not change color).
  const walls = [0xf2ead8, 0xf6f1e4, 0xe9dcc0, 0xd9584a, 0xc9483c, 0x4f9fd0, 0x3f86bf, 0x53b3b0, 0xf0c15a, 0x7fbf6a, 0xe58a4e, 0xf3ede0];
  const wallW = [3, 3, 1, 2, 1, 2, 1, 2, 1, 1, 1, 3]; // weights
  const roofs = [0xd2633a, 0xc9522f, 0xe07a45, 0xb84a2e, 0xd98a4a, 0x8f4a35, 0x4f8f8a, 0x556a86];
  const roofW = [4, 3, 3, 2, 2, 1, 1, 1];
  const woods = [0x7a5539, 0x8b6642, 0x6b4a30];
  const stone = [0xb7b0a4, 0xa9a397, 0xc3bdb0];

  const S = {
    spring: {
      grass: [0x8fd15a, 0x9bd962, 0x86c955], meadow: [0x9ddc6b, 0xa8e070, 0x93d262],
      leaves: [0x6cc04a, 0x7fcf58, 0xf4b6cf, 0xf8d0df, 0xffffff], blossom: [0xf6b3cc, 0xf9c9da, 0xfde6ee],
      pine: [0x3f9a55, 0x4aa85d], bush: [0x58b84a, 0x6cc656], flowers: [0xffffff, 0xffe066, 0xff8fb1, 0xb692ff, 0xff6f61],
      field: [0xb5d95a, 0x9ccc4f, 0xd6cf5a], sand: 0xe8d9a2, dirt: 0x9a7b55, snow: 0,
      sea: { deep: 0x1f8fa8, shallow: 0x62d6c9, foam: 0xffffff }, skyTint: 0xffc9e0, skyTintAmt: 0.10,
      cloud: 0xffffff, particle: 'petal', bare: false,
    },
    summer: {
      grass: [0x5fbf3f, 0x69c945, 0x54b338], meadow: [0x74cf4a, 0x80d554, 0x66c243],
      leaves: [0x3f9f3a, 0x4aad3f, 0x35902f, 0x55b647], blossom: [0x3f9f3a],
      pine: [0x2c7d46, 0x35894e], bush: [0x3fa036, 0x4cae40], flowers: [0xffffff, 0xffe066, 0xff6f61, 0xffa03a],
      field: [0xe6c94a, 0xd8b83d, 0x9dc44a], sand: 0xf0dfa0, dirt: 0x8a6a48, snow: 0,
      sea: { deep: 0x0f86b5, shallow: 0x4fdcd8, foam: 0xffffff }, skyTint: 0xfff2b0, skyTintAmt: 0.06,
      cloud: 0xffffff, particle: 'firefly', bare: false,
    },
    autumn: {
      grass: [0xb6b850, 0xc2a949, 0xa9b04a], meadow: [0xc4b64c, 0xcfb553, 0xb9b04a],
      leaves: [0xe8742c, 0xd9542a, 0xf0a935, 0xc8402a, 0xe6c23a], blossom: [0xe8742c],
      pine: [0x3f7d45, 0x4a8a4a], bush: [0xb2762f, 0x9c8a30], flowers: [0xffb347, 0xd9542a, 0xf7e07a],
      field: [0xe0b85a, 0xc99a3f, 0xb87c34], sand: 0xdccb95, dirt: 0x86643f, snow: 0,
      sea: { deep: 0x1d7d8f, shallow: 0x74c6b0, foam: 0xfff6e6 }, skyTint: 0xffb070, skyTintAmt: 0.14,
      cloud: 0xfff0e2, particle: 'leaf', bare: false,
    },
    winter: {
      grass: [0xeef4f8, 0xe4edf3, 0xf6fafc], meadow: [0xf2f7fa, 0xe9f1f6, 0xffffff],
      leaves: [0xdfe9ef], blossom: [0xdfe9ef],
      pine: [0x2f6f52, 0x3a7a5a], bush: [0xcfdde6, 0xdde8ee], flowers: [0xffffff],
      field: [0xe4edf3, 0xd6e2ea, 0xeef4f8], sand: 0xe6ecef, dirt: 0x8a7a6a, snow: 1,
      sea: { deep: 0x2f6f96, shallow: 0x8fc4da, foam: 0xffffff }, skyTint: 0xcfe3f5, skyTintAmt: 0.22,
      cloud: 0xdfe6ee, particle: 'snow', bare: true,
    },
  };

  function weighted(list, weights, r) {
    let tot = 0; for (const w of weights) tot += w;
    let x = r * tot;
    for (let i = 0; i < list.length; i++) { x -= weights[i]; if (x < 0) return list[i]; }
    return list[list.length - 1];
  }

  return {
    SEASONS, NAMES, S, walls, wallW, roofs, roofW, woods, stone,
    wall: (r) => weighted(walls, wallW, r),
    roof: (r) => weighted(roofs, roofW, r),
    rock: [0x8b8d92, 0x7d8085, 0x9a9da2],
    rockDark: 0x5d6067,
    plaza: [0xb9b2a3, 0xaaa394, 0xc7c0b1],
    path: 0xc9bfa6,
  };
})();
