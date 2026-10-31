# Changelog

All notable changes to `eva-inspired-theme` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **会话行 running 放大到 16px 盒子，并让一轮的末尾不再全黑（2026-10-31 第五十七轮）。**
  用户逐字两句：「光点消失到再出现会有一瞬间全黑」＋「动画能不能再大点？现在我感觉还是
  很小，还是没有官方默认的大」。① 盒子：官方那枚 `svg` 是 14px，改成 `width/height: 16px`
  （槽位本来就是 16×20，占满但不出格）。`viewBox` 仍是 24、组内 `scale(24/14)` 不动，
  所以整套几何整体乘 16/14 = 1.143 —— 外径 13.55 → 15.5px、点直径 2.2 → 2.51px、
  尾宽 1.31 → 0.71px；官方那环是 12.25px，这一版明显大一圈。最老那段笔宽同时从 `.5`
  提到 `.62`，否则那抹余温在 16px 下仍读不出来。② 黑场：级联熄灭不再归零 —— 第 `i` 段
  的亮度改由 `src/runtime/accretion.js` 的 `uniAccretionBandAlpha` 写，前五段仍是
  「年龄亮度 × 级联权重」，最老那段例外：从年龄亮度 `.04` 一路升到 `--uni-acc-floor`
  （暗档 `.22` / 亮档 `.30`），正好停在出生点上；下一轮的整组进场淡入又从同一个 floor
  起步，两头数值相等、位置重合，那 180ms 黑场因此消失。③ 亮度因此全部搬进 JS ——
  `.04 × stroke-opacity ≤ 1` 表达不了 `.22` 这种抬升；样式表只留笔宽与颜色，六条
  `opacity` 声明删除。④ `data-ds-dark-theme` 进 body 属性观察器，切明暗档时重读 floor。
  `css.18` 相应改成钉笔宽 + 钉 16px 盒子 + 钉两档 floor，`acc.2` 加 `UNI_ACC_BOX`、
  年龄亮度表与 `uniAccretionBandAlpha` 接线，新增 A4 钉「两头等值、只有最老段不退到零、
  余温单调上升、alpha 不越界」。门禁：`selfcheck` 123 断言 0 失败、`node --test` 66 通过、
  `build-client --check` 与 src 一致（229034 chars）。

- **会话行 running 改成隐式吸积中心：不画中心，点落进虚空（2026-10-31 第五十五轮）。**
  用户逐字：「不要黑点……通过运动暗示引力中心」。① 撤掉画在 `svg` 上的 2px 暗核——
  `--uni-acc-core`、`--uni-acc-core-fill` 两支令牌与那条 `background-image: radial-gradient`
  一并删除（亮档覆盖块同时消失），这一格的中心不再有任何实体、浅环或光晕。② 落点收到
  `r = 1.0`：没有暗核挡在中心，点一路落到虚空里再熄灭；`r(u) = 6.2 − 5.2u`，落程由
  3.8px 变 5.2px。③ 圈数跟着加：总转角 450° → 540°（`φ = 2π·1.5·(0.35u + 0.65u²)`），
  否则落程变长后相邻两趟的径向间隔松到读不成螺旋。④ 退场改成级联熄灭：
  `UNI_ACC_FADE_FROM = 0.8` 起，头部先熄、最老那段错开 `UNI_ACC_FADE_STAGGER = 0.45`
  才起步，`death = 1` 时整条归零 —— 读作「被吞」，而不是整格闪一下。熄灭压的是逐段的
  `stroke-opacity`，与样式表那层年龄段不透明度相乘，宽度与颜色不动。⑤ 兜底帧不再只留
  2px 短尾，改为「点停在 `u = 0.6`（`r = 3.08`）+ 从出生点到该点的完整尾迹」，静态下也
  能读出那条向内收紧的螺旋。⑥ 采样上限 48 → 56（现行几何实测 34 个采样点、轨迹
  28.96px）。
  `css.18` 相应改成反向断言（谁再把圆心填回去就红），`acc.2` 换新参数表，A1 改几何、
  新增 A3 钉熄灭顺序。门禁：`selfcheck` 123 断言 0 失败、`node --test` 65 通过、
  `build-client --check` 与 src 一致（226939 chars）。

- **会话行 running 放大到与官方环同量级（2026-10-31 第五十四轮）。** 真机第一稿被指出
  「又小又细」：官方那环在 14px 下外径 11.08px、线宽 1.17px，而第一稿外径 10px、线宽只有
  0.7 起。盒子是官方尺寸（主题不改组件尺寸），所以在盒内画满 —— 外半径 `5 → 6.2`、内半径
  `2 → 2.4`（`r(u) = 6.2 − 3.8u`，落程 3.8px）、点直径 `1.8 → 2.2`（`UNI_ACC_DOT 1.1`）、
  六段线宽 `.7/.62/.54/.46/.38/.3 → 1.15/1.02/.88/.75/.62/.5`。外径 12.4px 略大于官方环，
  线宽与它齐平；最宽一段的外缘到盒边仍留 0.225px，不被 14px 视口裁掉（A1 里钉了这条余量）。
  全程轨迹由 25.04px 变 31.0px、36 个采样点（上限 48 不变），`acc.2` 与 A1/A2 同步改成新数字。

- **会话行 running 改成「吸积流」：黑洞、一个绿点，尾巴是绿点自己走过的全部轨迹。**
  2026-10-31 第五十三轮，按用户逐字规格重做（「绿点从出现到消失的所有轨迹」「不要预绘
  螺旋、圆环、吸积盘、光晕」）。① 运动搬进 `src/runtime/accretion.js`：官方那枚 14px
  `svg[data-state='ongoing']` 里的两枚 r=9.5 圆整体 `display: none`，改成往同一个 svg 里
  追加一个 `transform: scale(24/14)` 的组（14px 设计稿 1 单位 = 屏幕 1px），组内是六条
  `<path>` 与一个 `<circle r=.9>`。② 每帧从头部按弧长走回 `u = 0`（本轮出生点），把这段
  折线按弧长均分成六段，段号即年龄：宽度 `.7 → .3`、不透明度 `.55 → .04`，末尾读作一圈
  多的暗绿螺旋，头部仍是唯一亮点 —— 尾巴不是画上去的形状，是运动的产物，重生瞬间归零。
  ③ 运动参数照抄规格：周期 1300ms、`r(u) = 5 − 3u`（第五十四轮放大成 `6.2 − 3.8u`）、
  `φ(u) = 2π·1.25·(0.35u + 0.65u²)`（全程 450°，角速度随内落变快，所以与 pending 的匀速
  绕行在 14px 下也能分开）。
  ④ 颜色仍只有一枚令牌 `--dsw-alias-state-success-primary`，暗核走
  `bg-module-platform` / 亮档 `tooltip-bg`；没有背景、边框、文字色、行内布局改动。
  ⑤ 采样循环复用现有 `universe: paint layer` effect，**不新增 `ctx.effect`**（`cli.11d`
  钉九个 —— 十变九是上一轮撤掉 selection optics 的结果，不是这一条）；`prefers-reduced-motion`
  或动效开关关掉时只画一帧静态：绿点停在轨迹上的 u = 0.6（r = 3.92、φ ≈ 110°），身后一条从
  同一条轨迹上切下来的 2px 短尾 —— 姿态与动态同源，不是另画的圆弧。门禁：`selfcheck`
  123 断言 0 失败、`node --test` 64 通过、`build-client --check` 与 src 一致。

- **悬停塌陷的触发面从 `:hover` 换成 `[data-uni-grav]`，边缘抽搐根除。** 2026-10-31
  第四十九轮。症状：元素把自己缩到 0.97（纯图标按钮 0.90），命中区跟着缩，指针停在最外
  1.5%（图标按钮 5%）一圈时 `:hover` 立刻掉线 → 弹回原尺寸 → 又落回元素上，两帧之间
  在 0.97 与 1.00 之间无限振荡（实测光标停在左边 2px 处可见）。病根是「触发状态的那个
  盒子，同时就是收缩的那个盒子」，而 CSS 里唯一稳定的触发面是祖先 —— 通用元素的祖先
  还装着兄弟，挂上去会连坐。所以新增 `src/runtime/gravity.js`，按**未缩放的盒子**记账：
  指针进元素挂属性、留在原始盒子里状态不变、离开才摘。原始盒子由 `rect / 当前 scale`
  反算，过渡进行到一半也读得住；只认鼠标与触控笔，触摸的粘滞 `:hover` 不入账。挂载点
  是装样式表那个 effect，**不新增 `ctx.effect`**（`cli.11d` 仍钉十个）。会话行保留
  「父级悬停」那条 —— 它有专属包装，触发面本来就稳定。亮档那条 `:has(> :hover)::after
  { scale: 1 }` 抑制成了死规则，已删。

- **置顶会话行的标题改香槟金（恒星锚定）。** 2026-10-31 第五十轮规格：香槟金标题 +
  Semibold 600 + 一层极弱静态辉光（暗档 `#E6C78F`、亮档 `#89672F`），字号字距不动，
  预览、时间、辅助信息一律不动，不加图标、背景、边框、下划线、指示条、角标或动画，
  「不添加明显投影」。① 钩子是 `[data-row-key^='session:']:has([class*='pinIndicator'])
  > span:nth-child(2)` —— 置顶的唯一事实来源就是官方那枚 pinIndicator，主题不引入第二个；
  取消置顶时属性一撤、规则自动不再匹配，官方字色自己回来。② 颜色不写字面值（`css.8`）：
  暗档 `warn-secondary 88.5% + label-caption`，落点 `rgb(230,197,143)`（G 通道比目标低
  2/255，两色线性混色在 8 位色深下的下限）；亮档 `warn-secondary 75% +
  business-primary`，落点 `rgb(134,104,47)`（代价写进注释：这枚古铜依赖 business 令牌）。
  ③ 辉光只写未选中的行 —— 选中行那条 `text-shadow` 归多普勒，两套效果不抢同一个通道。

- **选中态两套光学现象重做：多普勒改成单侧暖副影，透镜改成位移图。** 2026-10-31 第五十
  轮规格与第四十八轮有三处硬冲突，所以整体重做而不是调参。① 多普勒：旧版「左品牌青 +
  右错误红」对称双向，新规格只要暖色副影且「有明确方向」，现在只往右侧长波端拖两层
  （`warn-secondary` 香槟金 → `warn-primary` 琥珀金），左侧干净 —— 红移只有远离观察者
  那一侧。暗档单独加强（第五十一轮，用户原话「暗色下再调整下，跟白色的普通文字太接近
  了」）：两层与深色底各混一档成铜色（`--uni-sel-warm-near/far`），位移抬到 0.75/1.5px、
  不透明度 88%/62%。② 引力透镜：旧版六层对称 `text-shadow` 是「重影」不是「形变」，新
  规格要求字形局部非对称弯曲，几何交给新增的 `src/runtime/selection.js` ——
  `#uni-sel-lens` 用 `feDisplacementMap` + 固定径向位移图（非奇异等温球，中心偏折 0、
  边缘饱和，光学中心偏右 6% 才有非对称），不用 `feTurbulence`（随机噪声在文字边缘读作
  毛刺）。位移图只挂真正的文字节点 `[data-uni-sel-text]`：挂在行/按钮上会连带图标与
  箭头一起扭，找不到文字节点的对象整类跳过。③ 入场：`@property --uni-sel-k` 注册成
  `<number>` 才能补间，`selection.js` 用 WAAPI 把峰值 2.4 推回稳定 1，只在用户真的换了
  选中时播一次。④ 透镜强度第五十一轮加倍（用户原话「引力透镜效果还是差点，不容易看清
  区别」），位移与次级像一起抬 —— 只抬位移会让字形读作「本身长歪」。⑤ `selection.js` 是
  第十个 effect，`cli.11d` 由 9 改 10，`CLIENT_FILES` 追加 `gravity.js` 与 `selection.js`。

### Removed

- **会话行的状态标记全部交回 DSH 官方。** 2026-10-31 逐字：「全部删除，包括指定，我们自己
  重新设计。」`build/session-eva-status.js`（内置的状态 rail）连同它的 effect、`data-uni-life`
  钩子、`src/client.js` 的 `uiSession` 注入一起撤走；pending / 完成未读 / running 三态
  一律按官方原样显示，主题不再写那一格的任何图形。`src/theme.css` 原位留了一段说明，写清
  这一格已交还、以及日后重新接管的入口在哪。

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
