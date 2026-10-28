# Changelog

All notable changes to `eva-inspired-theme` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **亮档黑洞不再是一块纯黑，veil 角色换人：整页那层退回 23.5%，改由输入卡自己做背板。**
  2026-10-28 逐字：「亮色模式下的黑洞颜色太深了，输入框中的文字都看不见了，而且跟白色系的
  背景也不搭。」上一版把该页 `body::after` 整层撤掉，黑洞确实清楚了，代价是输入卡的玻璃只剩
  20% 的背板 —— 卡片后面是纯黑影子，占位字压在中灰上。结论是 veil 不要撤、要降到够用，
  而「够不够」是**逐表面**的问题：① `body:not([data-ds-dark-theme])[data-uni-black-hole]:
  has([data-black-hole-state='ready'])::after { opacity: .28 }` —— 有效 α = 0.84×0.28 ≈
  0.235，画布留 76.5% 强度，影子从 `#101725` 落到 `#414449`（实测像素 65/68/73），不再是
  纯黑也不再冲击白底；暗档不落进本选择器（`body[data-ds-dark-theme]` 原样），星野页没有
  `data-uni-black-hole` 也不落进。② 卡片缺的是**局部**背板，所以同一条 `:has()` 上再给
  `[data-composer-card]` 换纸色底面 `background-color: var(--dsw-alias-bg-base)`（亮档 α0.84
  的纸色令牌，影子透 16%）—— 卡内合成从 195 抬到 211，占位字对比度回到 3.9:1；卡片以外
  一个像素不改，玻璃的 `::before`（blur 4px + saturate）仍挂着，液态玻璃在会话页照旧。
  两条都只动颜色**来源**、不写字面色值（`css.8`）。③ 影子墨色同时从 `#0b0f14` 调到
  `#101725`（`HORIZON_INK`），冷蓝向、跟月白/深空蓝同族。④ 复核：模拟合成（Pillow 按
  α0.235 叠纸色、再按 0.84 叠卡面）得到的像素与上面两个数一致；`selfcheck` 121/0、
  `black-hole.test.mjs` 4/4、`build-client --check` in sync。

- **新会话页的黑洞放大一档，亮档补上视界实体。** 2026-10-28 逐字：「1. 新会话界面的
  黑洞太小，留白太多。2.亮色模式下的黑洞不显眼 ，看不出来是黑洞。」① 取景：
  `SHADOW_SHARE` 0.34 → 0.44（`src/runtime/black-hole.js`），影子直径从 0.68 倍短边到
  0.88 倍，几何比例不变、只把左右外围裁掉；1600×1000 下黑盘 680 → 880 px，上下留白各
  少约 100 px。② 亮档：`draw()` 先在纸上填一颗正圆墨盘（半径 `SHADOW_SHARE`×短边/2，
  Schwarzschild 阴影在观测天球上本就是正圆，故不用多边形），盘面格子再按径向分派两套
  色阶 —— 视界内用 `DARK` 暖亮阶（前景盘穿过洞面仍发光），视界外用 `LIGHT` 墨阶；
  暗档一字未改。③ 根因是 `body::after` 与画布同为 `z-index:-1` 却树序在后：亮档那层
  `--dsw-alias-bg-base` 是 α=0.84 的白纸，画布只剩 16% 强度，黑洞被冲成灰雾 ——
  这条的处置见上一条（降 α、换卡片背板），不是配色问题。④ 门禁：
  `tools/black-hole.test.mjs` 的 fixture ctx 补 `beginPath`/`arc`/`fill` 并把调用记下来，
  新增一条「暗档不填盘；切亮档后恰好填一颗圆心在视口中心、半径 = `SHADOW_SHARE`×短边/2
  的盘」。`npm run build` 后 `selfcheck` 121/0、`black-hole.test.mjs` 4/4、
  `build-client --check` in sync。

- **新会话页去掉那行大字，只留输入框。** 2026-10-28 逐字：「去掉 dsh-universe-theme
  新会话页面的文字，只保留输入框。」删的是整行（`[data-phase='hero']` 里那行标题），
  不只是 `::before` 注入的德文：两个子 span 早已隐藏，但空 flex 行仍占住 HeroShell 的
  间距，只删文字会留下一段空白。D75 的 Great Vibes / `cqw` / `nowrap` 随之失效，`font.3`
  门禁改成「整行 `display: none`，且不留 `::before` 注入与 `container-type`」；字体文件、
  `@font-face` 与 `font.1`/`font.2` 原样保留（删的是一次渲染，不是资源，回滚不需重新下载）。
  composer 卡、选择工作区与两个下拉未动。

- **左栏品牌标换成用户给的墨笔黑洞位图。** 2026-10-27 逐字：「修改 dsh-universe-theme，
  把这张图片设置为左栏顶部的品牌Logo」。`build/brand-mark-black-hole.png`（1254² 原图裁到
  墨迹边界、缩到 256²，黑底写成 alpha）经 `--cp-brand-mark` 内嵌进包，`src/brand-logo.css`
  把它当遮罩、用 `currentColor` 上色，所以同一份字节在暗档是白墨、亮档是黑墨，不需要第二张图。
  组件（`src/runtime/brand-logo.js`）只保留 28px 盒子和 `sidebar.brand.mark` 的 −1 注册；
  原来的矢量几何（`src/runtime/brand-logo-geometry.js`）不再进包，文件留在盘上。动画一并
  去掉：给定的是一张静态画，不做没人要求的漂移。

- **配色换族：EVA 紫黑/薰衣草白 → 深空蓝黑/月白，品牌从橙改为星芒青。**
  用户 2026-10-25 逐字：「更换目前亮色和暗色模式的配色方案，目前是挪用的EVA主题的配色，
  我想换一个更护眼，更契合宇宙主题的配色」。这条指令**同时覆盖暗档**，因此 `tools/selfcheck.mjs`
  的 2026-10-08 暗档冻结被重新打开一次（`DARK_TOKENS_SHA` → `38ed701923cc7d8c`，
  `DARK_VEILED` → `#11172059`），注释按既有惯例写明是谁、哪一天、为什么。

  暗档底色锚从 h300 `#1a1325` 移到 h258 `#111720`，亮档从 h300 `#e2e1ed` 移到 h250
  `#eff2f5`；侧栏、菜单、输入、遮罩底随同换族。墨色梯两档重新解 L；品牌/链接改青
  （暗 `#87cbd5`、亮 `#006874`），state-business 从紫改灰蓝，TINT 叙词换成
  `brand` / `status-*`，边框改用自档墨色而不是对侧底色。全部取值由
  `tools/s2-palette.py` 重解后经 `tools/s3-emit-tokens.py` 写入 `src/tokens.json`，
  40 组对比度 `unresolved=0`。

  ASCII 黑洞的字符色阶同步换过：暗档从橙铜换成「冷尘 → 暖盘」，亮档从褐黄换成
  「冷灰 → 近黑」的铜版画墨阶，底色对齐 `#0c111a` / `#eff2f5`。

## [1.3.0] — 2026-10-25

### Removed

- **The vendored 插件一键启停 half is gone.** `dsh-disable-unofficial-plugins` is
  published on its own now, so the theme no longer vendors, patches or ships any part
  of it. `build/plugin-toggle.js` (66,968 bytes, v1.3.0) was deleted, along with the
  builder's factory slice, `applyPluginToggle(ctx)` in `src/client.js`, the
  `pluginToggleJs` template hole, the four checks that pinned the copy (selfcheck
  `cli.19`, `cli.20`, `vend.1`, `cli.28`) and the `S7` runtime test. The effect count
  `cli.11d` pins drops 10 to 8.

  NOTICE section 3, both READMEs' licence tables and the builder banner were rewritten
  to match. D82's host-bundle exclusion went with the copy: that protection only
  existed because the switch sat inside this theme's own client bundle.

### Action required

- **Install the switch separately.** The 插件一键启停 button is no longer part of this
  theme:

  ```bash
  dsh plugin --profile <profile> add dsh-disable-unofficial-plugins
  ```

  Without it the theme works exactly as before, minus the switch.

### Changed

- `client.js`: 2,262,671 to 2,213,383 characters (-49,288, -2.2%), all of it the
  vendored block and its provenance comments. One fewer `ctx.effect` pair at load time.

Verified: 121/121 selfcheck assertions (four retired with the copy), 15/15 runtime
tests (S7 retired), build in sync.
## [1.2.1] — 2026-10-25

### Fixed

- **`README.zh.md` was never published.** It is referenced from `README.md`'s language
  switch and from `README.zh.md`'s own header, but it was missing from `files` in
  `package.json`, so every tarball pointed the Chinese link at a path that did not exist.
  Added; the package now ships both editions.

No runtime change: `client.js`, `src/`, `build/` and the patch are untouched
(16/16 tests, 125/125 selfcheck assertions, build in sync).

## [1.2.0] — 2026-10-25

### Removed

- **The channel-entry buttons on the 「工作区」 row**, and everything that only existed to
  serve them. They now live in their own plugin,
  [`dsh-im-workspace-buttons`](https://github.com/WhatCannotBeSaid/dsh-im-workspace-buttons),
  so the behaviour survives on its own and stops depending on a theme being installed.

  Gone from this package:

  | File | What left |
  | --- | --- |
  | `src/runtime/im.js` | The whole module (842 lines): the twelve-channel table, the twelve inline SVG marks, the account gate, the row filter, the unfold pump |
  | `src/client.js` | The Round 64 comment block and the `'evangelion: im channel filters'` effect (`ctx.effect()` count 11 → 10) |
  | `src/theme.css` | The 84-line `data-eva-im-*` block: the four entry rules and the one filtering rule |
  | `tools/build-contract.mjs` | `src/runtime/im.js` out of `CLIENT_FILES` |
  | `tools/selfcheck.mjs` | `css.12` and `cli.26` (their contracts went with the code), the label assertion in `cli.11d`, and its effect count 11 → 10 |
  | `tools/runtime.test.mjs` | `statusHarness` and the S3/S7 cases built on it; `'im'` out of the vendored-module list |
  | `README.md` / `README.zh.md` | The channel-filters bullet and the `还包含` table row cell |

### Notes

- **Nothing else changed.** Every other visual and behavioural feature of the theme is
  byte-identical to 1.1.0; the gates agree — `npm test` 16/16, `npm run selfcheck`
  125/125, `npm run verify` all green, `build-client --check` in sync.
- **`docs/design.md` and `docs/render-report.md` keep their history.** They are append-only
  round logs, so their existing `data-eva-im-*` entries stay as written — that is the record
  of what those rounds did, not a description of the current tree.
- **Installing both.** If you ran the theme before 1.2.0 and want the buttons back, install
  the plugin; the two packages do not collide (different attribute names, different locale
  namespace, each removes its own `<style>` on unload). Nothing needs to be configured in
  the theme.

## [1.1.0] — 2026-10-24

### Added

- Channel-entry buttons on the 「工作区」 row: one per channel `@xmanrui/dsh-im` ships
  (twelve), each asking its own `connection.status` route and staying in the row only while
  that channel has an account. One view lit at a time; a view tags the rows it keeps and
  stores nothing.
- Adaptation to DSH `0.2.1-rc.3`.

### Changed

- The 微信 workspace switch (`data-eva-wx-*`) retired in favour of the channel entries.

## [1.0.0]

- First public release: Title Card (light) and Central Dogma (dark) modes over one removable
  override layer, the wallpaper paint layer, the workspace pin control, the vendored
  plugin toggle and session status rail, the boot mask, centred composer panels.
