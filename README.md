# PCG 小岛 · Low Poly Town

一个在浏览器里运行的 low poly 程序化小岛编辑器。在海上画出不规则地块，程序会自动在上面生成小镇：彩色房屋、广场、田地、森林、沙滩、码头，以及白塔、教堂、风车、灯塔等地标。支持春夏秋冬切换和昼夜循环，海鸥、帆船、云、季节粒子和合成环境音让小岛保持生机。

纯 HTML + JavaScript，基于 [three.js](https://threejs.org/) r158，没有构建步骤。

## 运行

1. 下载 three.js r158 的 `build/three.min.js`，放到 `lib/three.min.js`：
   <https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js>
2. 双击 `index.html` 打开。

没有本地 `lib/three.min.js` 时，页面会自动从 jsdelivr / unpkg 在线加载（需要联网）。

## 操作

| 操作 | 按键 |
| --- | --- |
| 生成地块 | 左键点击 / 拖动 |
| 删除地块 | 右键点击 / 拖动 |
| 画笔大小 | 滚轮，或 `[` `]` |
| 缩放 | Ctrl + 滚轮，或 `+` `-` |
| 旋转视角 | 中键拖动 / Alt + 左键，或 `Q` `E` |
| 平移 | Shift + 中键，或 `WASD` / 方向键 |
| 切换季节 | `1` `2` `3` `4` |
| 暂停时间 | 空格 |
| 随机岛屿 | `R` |
| 撤销 / 重做 | Ctrl + Z / Ctrl + Shift + Z |
| 静音 | `M` |
| 回到岛屿 | `F` |

音效在第一次点击页面后启动（浏览器的自动播放限制）。

## URL 参数

`?season=winter&time=0.85&seed=123&pause=1&instant=1&debug=1`

- `season`：`spring` / `summer` / `autumn` / `winter`
- `time`：0–1，0.25 日出，0.5 正午，0.75 日落
- `seed`：固定岛屿形状
- `pause=1`：暂停时间
- `instant=1`：跳过弹出动画
- `debug=1`：显示帧率和 draw call

## 代码结构

| 文件 | 内容 |
| --- | --- |
| `js/util.js` | 带种子的随机数、哈希、噪声、缓动 |
| `js/grid.js` | 不规则四边形网格（六边形剖分 → 随机合并 → 细分 → 松弛） |
| `js/palette.js` | 四季配色 |
| `js/geo.js` | 平面着色的 low poly 几何构建器 |
| `js/builders.js` | 地面、房屋、树、地标、码头、船等 PCG 模型 |
| `js/zoning.js` | 分区规则：每个地块放什么 |
| `js/world.js` | 地块状态、增量重建、弹出动画、海岸遮罩 |
| `js/env.js` | 天空、海面着色器、光照、昼夜、星星、云 |
| `js/life.js` | 海鸥、帆船、季节粒子 |
| `js/audio.js` | Web Audio 合成的海浪、海鸥、蟋蟀和音效 |
| `js/input.js` | 画笔和相机控制 |
| `js/main.js` | 初始化、UI 绑定、渲染循环 |

## 测试

```
node test/smoke.js     # 网格、分区、模型生成
node test/runtime.js   # 用 three.js 桩跑完整程序：画地块、删除、撤销、四季、昼夜
```
