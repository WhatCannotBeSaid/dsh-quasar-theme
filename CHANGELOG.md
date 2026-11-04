# Changelog

All notable changes to `eva-inspired-theme` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **吸积盘换成 24 个有限寿命、差速切变的亮斑（2026-11-04 第八十二轮）。** 用户逐字：「你再检查下代码看是否可以优化」。
  `src/runtime/accretion-disk.js` 去掉旧的 SPIN / DISK / KNOTS / PULSE 四层，也去掉每格里的三角函数（旧版每格
  2~4 次 `sin` + `log`），换成纯算术早退。常量与动机写在源码注释里：`ORBIT_RATE = 16` 是校准旋钮（既不动度规、
  也不动 `ray.g4`），`orbit(r) = ORBIT_RATE / Math.pow(r, 1.5)` 即 Schwarzschild 圆轨道 `Ω = r^(-3/2)`
  （hot-spot/arc 动机见 Schnittman & Bertschinger, astro-ph/0309458；MHD 变光动机见 Schnittman et al.,
  astro-ph/0606615；这是现象学模型，不是 MHD 求解）。24 个 patch 各自 `life = 0.9·TAU/orbit(r)`、
  `amplitude = (1.5+seed)·sin²(π·age/life)`，种子取自 `grainKey`；`patchAt` 先按 `|dr| >= 1` 早退，再按
  `|dp| >= 1` 早退，多数格子死在径向闸门。关键一处：每个半径各自被平流（`dp = phi - p.phi - omega*p.age`），
  有限宽的斑因此被剪成弧，而不是整块平移；暗底 `emission` 基值 `0.32`，不做全盘呼吸。`shade` 从 5 参收到 3 参
  （`ray, time, brightness`），亮度只随 `ray.g4` 走。`tools/black-hole.test.mjs` 同步改写。
  同轮追修两处既有问题（都与本次重写无关）：
  `preview/black-hole-hybrid.js:102-103` 仍读已被测地线内核移除的 `ray.boost`（`src/runtime/geodesic.js` 只返回
  `g4`，注释写明不保留兼容字段），于是整层 ASCII 盘恒为 0、只剩矢量阴影/环/辉光；改成 `ray.g4` / `g4:` 两个词。
  `tools/dialog-arc.test.mjs` 的两个用例（`主线程卡住不再冻住洞`、`reduced motion：交给 __uniArc 的时长为 0`）
  在 `f.drain()` 后补一行 `f.frameAt(0)`，消费掉挂载时的冷启动 settle 补帧；该断言早于 settle 机制（2cd3def
  引入），在 HEAD 上本就失败，不是这次改坏的。
  门禁：`node --test tools/black-hole.test.mjs` **34 pass / 0 fail**、`node --test tools/dialog-arc.test.mjs`
  **15 pass / 0 fail**、`npm run verify` **113 assertions / 0 failed / all green**、`npm run check` 同步，
  `client.js` **246,126 chars / 53 tokens / 2 fonts / 0 wallpapers**（预览与测试两处改动不进构建产物，
  故尺寸不变）。

- **输入卡转场改成「连续运镜」（2026-11-03 第八十一轮）。** 用户逐字：「我选B」——B 指上一轮对比里
  的连续运镜：全量位移、卡片全程可见，而不是淡出淡入。`src/runtime/composer-transition.js` 的
  `play()` 把透明度从 `0→1` 改成浅呼吸 `1 → 0.86 → 1`（`DIM = 0.86`，中点最暗，与位移共用同一条
  easeInOutCubic 的 12 段关键帧，1000ms 不变），位移仍走全量 FLIP：新卡第一帧就带着回位的
  transform 画在英雄页位置，观感是同一张卡连续滑落，不再是「原地消失 → 底部冒出」。`enter()` 遇到
  settling 等中间相即作废起点，绕过中间相才到的 active 不会从过期位置起飞（不按时间判定：用户在
  英雄页停顿再发送，仍从最后记录的位置起飞）。宿主 `settling` 经核实
  （`app.asar`，`ConversationMainPanel`）只出现在打开历史会话、摘要仍在 loading 时，发第一条消息的
  hero→active 不经过它——「消失」的真正来源是旧节点卸载 + 新卡 opacity 从 0 起播，不是 settling 的
  `visibility:hidden`。`DIM` 取 0.86 而非 0.4：黑洞终态是停泊在淡态，卡片落地必须回到可读的实态，
  这里只借节奏不借浓度。已知未做：两页卡片宽高不同时起播第一帧会暴露尺寸跳变（FLIP 只补位移不补
  scale，需真机确认是否可见）；宿主若分两次提交相位与卡片节点，刷新落点那一帧会空转且不重试。
  同一轮追修（用户报「落到位置时整个输入框由亮变暗」）：动画目标从 `[data-composer-card]` 换成它的
  父节点。卡片自己带 transform 就形成层叠上下文，`z-index: -1` 的模糊背板（`::before`，refraction +
  blur）会从卡片背景**之下**翻到**之上**，运镜中整卡偏亮、transform 一撤就恢复原亮度读作「变暗」；
  父节点没有背景也没有伪元素，带 transform 只移动盒子。位移量仍按卡片 rect 算，两者同坐标系。
  重建后 `client.js` **246,126 chars / 246,500 B**、`npm run verify` **113 assertions / 0 failed**、
  `node --test tools/runtime.test.mjs` **55 pass**。

- **「插件」行收回导航区，Logo 改指插件面板（2026-11-02 第八十轮）。** 用户逐字：「导航区的插件去掉呀，
  把插件入口重新换到品牌Logo上。」品牌行回到第二十五轮那套分区：**Logo → 插件、`QUASAR` → 新会话、
  `CORE` 芯片 → 设置**。`src/theme.css` 重新放回按可访问名藏插件行的两条选择器（zh `插件` / en
  `Plugins`），同 nav 里 `ui-schedule` 那行不动；`src/client.js` 恢复 `PANEL_ROW` 常量，分区判定改回
  `zone` 三分（插件行缺失时不拦截，落回官方新会话）；`tools/selfcheck.mjs` 的 `css.10` 从「一条
  `nav[aria-label]` 规则都不许有」反向回「必须按名藏、且中英两名都写」。README / README.zh 的三段
  点击区表与被隐藏入口表同步（重新加回「插件」行，设置行改「点 `CORE` 芯片，或 `Ctrl+,`」）。
  重建后 `client.js` **237,229 chars / 237,603 B**、`2 fonts`、`npm run verify` **113 assertions / 0 failed**；
  真机复测品牌行几何未变（25.00–208.00，墨迹中心 20.50 / 20.50 / 20.25）。

- **芯片回来：`CORE` 以 EB Garamond 500 / 12px 恢复（先 14px，随即调小），品牌行回到三区（2026-11-02 第七十九轮）。** 用户
  逐字：「B，CORE调到14px/500」——B 指恢复第三区，即点芯片开设置。`src/theme.css` 重新放回
  `[data-window-drag='true'] button:has([data-slot='sidebar.brand.name'])::after`：`content:'CORE'`、
  `font-family:'EB Garamond', Garamond, Georgia, serif`、`font-weight:500`、`font-size:12px`，几何
  （10px 外边距、4px 8px 内边距、硬边、`letter-spacing:0.8px`、84% 混合底）一字不改。
  `src/client.js` 的品牌行 effect 回到三区，判定改成「只放行 name 盒子那一段」：
  `if (event.clientX >= markRight && event.clientX < nameRight) return`，左侧贴图与右侧芯片都截下并转给设置。
  `build/fonts.json` 重新收进 EB Garamond 500（`build/eb-garamond-latin-500.woff2`，25,264 B，连同 OFL）。
  芯片补回了名字右侧那段留白：品牌组 25.00–139.00 扩到 **25.00–208.00**，缺口 166.50 → **97.50**；
  三件套墨迹中心仍是 **20.50**（芯片 20.25）。重建后 `client.js` **236,644 chars / 237,010 B**、`2 fonts`、
  `npm run verify` **113 assertions / 0 failed**。README / README.zh 的三区表与「被隐藏的官方入口」表同步。

- **芯片撤掉，Logo 改指设置，插件行交还导航区（2026-11-02 第七十八轮）。** 用户逐字：「去掉
  「CORE」，将黑洞Logo的功能调整为点击进入设置，将导航区的「插件」按钮重新显示！」三件事一起做：
  `src/theme.css` 里那枚 `[data-window-drag='true'] button:has([data-slot='sidebar.brand.name'])::after`
  芯片整条删除（连内边距、硬边、84% 混合底），按可访问名藏「插件」行的规则也整条删除，nav 里
  plugin-manager 与 ui-schedule 两行恢复官方默认；设置启动按钮**仍然隐藏**。`src/client.js` 的
  品牌行 effect 从三区收到一区：只有 `clientX < mark.getBoundingClientRect().right` 被截下并转给
  设置（按钮在就 `.click()`，不在就走 `pressSettingsShortcut()`），文字区与行上其余位置一律不拦截。
  `EB Garamond` 因此不再随包：`build/fonts.json` 只剩 Cinzel，`build/eb-garamond-latin-700.woff2`
  与那份 OFL 移入回收站。`tools/selfcheck.mjs` 的 `css.10` 方向反转 —— 从「插件行必须按名藏」改成
  「本表不许出现任何 `nav[aria-label]` 规则」。重建后 `client.js` **202,142 chars / 202,508 B**、
  `npm run verify` **113 assertions / 0 failed**。

- **品牌行换名换字：`WHALE-01` → `QUASAR`，`SYSTEM` → `CORE`，两枚字面随包内嵌（2026-11-02
  第七十七轮）。** 用户先问「左栏顶部的品牌名称仍是「WHALE-01」「SYSTEM」，要不要改呢？改的话
  改成什么好呢？用什么字体呢？」，随后逐项拍板：`-01` 去掉（「宇宙主题不用加数字」）、主名选
  `QUASAR`、芯片选 `CORE`、主名 `Cinzel` + 芯片 `EB Garamond`；芯片随后被点名提到 `12px / 700`
  （原排 `11px / 500`）。
  改动：`src/theme.css` 的 `[data-slot='sidebar.brand.name']` 换族 Cinzel 700 / 0.10em，`::before`
  出 `QUASAR`；`-01` 那条 `::after` 整条删除，随之失去「实色主词 + 78% 混合后缀」的两档层次，
  层次改由字号（16 对 12）与明暗（亮字压暗底 / 深字压浅块）承担；芯片 `::after` 改 `CORE` +
  EB Garamond 700、12px。`build/fonts.json` 是新的来源记录（对齐 `build/wallpapers.json` 的形状），
  `tools/build-client.mjs` 读它生成 `@font-face` 拼在 `declarations` 最前、按记载字节数校验，
  `tools/selfcheck.mjs` 新增 `font.1` 钉住「表里点名的字族必须是包里带的那两枚」。重建后
  `client.js` 237,231 chars / 237,605 B，`npm run verify` **113 assertions / 0 failed**。

  换族的原因不是审美：原栈 `Bahnschrift, 'DIN Alternate', 'DIN Next', 'Eurostile Extended',
  'Montserrat'` 里只有 Bahnschrift 在 Windows 上真存在 —— DIN Alternate 是 macOS 字体，DIN Next
  与 Eurostile Extended 是商业字体，Montserrat 要装，所谓跨平台稳定只在构建机成立。

  报数：两枚 woff2 合计 40,476 B（Cinzel 700 15,184 / EB Garamond 700 25,292），base64 后
  `declarations` 由 ~16K 涨到 70,373 chars；两份 OFL 全文随包（`build/cinzel-OFL.txt`
  4,383 B、`build/eb-garamond-OFL.txt` 4,398 B）。

- **亮档弧带换成更高对比度的绿（2026-11-02 第七十六轮）。** 用户逐字：「再优化一下亮色下
  的配色，现在不够显眼，应该也是对比度不够的原因，找一个对比度更高的绿色」。量下来，亮档
  继承的宿主 `--dsw-alias-state-success-primary` 是 `#397949`（oklch 0.521 0.100 150），
  对 `#f9fafc` 有 5.02:1，但它是一枚**灰绿**：彩度只有 0.10，再乘上弧带自己的
  `stroke-opacity`（三尾段 0.85 / 0.6 / 0.38 × 呼吸 0.75~1）之后，在 `#e8ebef` 那类偏灰
  的浅底上只剩 4.38:1，1.3px 的弧就糊了。`css.8` 不许主题自造字面色值，所以不改 hex，
  而是在宿主绿上做 oklch 派生：`body:not([data-ds-dark-theme])` 里把 `--uni-acc-dot` 与
  `--uni-acc-trail` 一起换成
  `oklch(from var(--dsw-alias-state-success-primary) 0.48 calc(c * 1.5) h)` —— 明度
  0.521 → 0.48、彩度 ×1.5（0.100 → 0.150）、色相不动，派生结果约 `#007329`：仍是同一支
  绿，更深更饱和。实测对比度从 `#f9fafc` 5.02 → 5.77、`#eff2f5` 4.67 → 5.36、
  `#e8ebef` 4.38 → 5.04，三档全部过 WCAG AA 4.5:1。暗档一个字节都没动：`body` 里仍读宿主
  令牌，深底上那枚 `#7fcc94` 本来就有 7:1 以上，且 `dark.2` 钉住每一个暗档值。门禁：
  `selfcheck` 的 `css.18` 新增「亮档派生公式 + 头尾同色 + 暗档仍读宿主令牌」三条断言，
  并按 `src/tokens.json` 的宿主亮档值把 oklch 公式真算一遍、用 WCAG 公式量三档浅底都
  ≥ 4.5:1（公式被改浅、改灰或改黄就红）—— 120 断言全绿；`npm test` 五套 83 通过；
  `client.js` 重建 188311 chars（boot mark `uni-boot/9b6ba813`），`build-client --check`
  与 src 一致。

- **会话行 running 从螺旋吸积流改成日冕弧带（2026-11-02 第七十五轮）。** 用户逐字：
  「感觉还是螺旋结构的问题，只有完整的圆才能实现连续」，随后在 grilling 里把判据钉成两条
  （m00676 选 C）：位置连续（单一主体、逐帧不瞬移）**且**形状连续（轮廓任何时刻都不断口、
  不重新起笔）；m00685 同意「放弃开口形态，但要是宇宙主题」。这两条判掉了整条吸积流 ——
  螺旋是开口曲线，外圈 `r = 6.2` 与中心 `r = 1` 相距 5.2px，单主体走完一轮必须跨过这段位移，
  而淡入淡出、静止交接层、会动的 ghost、双流相位交错都只能盖住亮度，盖不住位移（m00682）。
  于是这一格换成**闭合圆环上的一段弧带**：`UNI_ACC_RING = 5.6`、圆心 `(7,7)`、周期
  `UNI_ACC_CYCLE = 1300`、顺时针（m00844「方向反了！现在是逆时针，改成顺时针」纠正过方向，
  头端角度改成 `−π/2 + 2π·turn(t)`）；弧长在 `0.28 ~ 0.44` 圈之间每圈呼吸一次
  （`UNI_ACC_ARC_MIN / MAX`，用户 m00695 允许），整体亮度 `0.75 + 0.25·k` 跟着呼吸走；
  头段占 40%、三尾段各乘 `[0.85, 0.6, 0.38]`（m00698 选 B：头亮尾淡）；角速度每圈两次微加速
  `θ(t) = 2π(t − 0.1·sin(4πt)/(4π))` —— 匀速定长弧就是官方 spinner 换皮，变速与呼吸是
  这一格与默认 loading 的唯一分界。弧带本身即主体，头端 round cap 收成圆头，不再另画
  `circle`；每帧重写四段 `d` 与 `stroke-opacity`，不用 CSS 旋转、不用 `dashoffset`。
  删除：六段尾迹（`uni-acc-t0~t5`）、`uni-acc-ghost` 交接层、`uniAccretionRemnant`、
  双流（`UNI_ACC_STAGGER` / `UNI_ACC_DOT_DIM` / `UNI_ACC_TAIL_SPAN` / `UNI_ACC_AGE` /
  `UNI_ACC_BORN` / `UNI_ACC_FADE_FROM` / `uniAccretionDotAlpha` / `uniAccretionBandAlpha`）——
  它们存在的唯一理由是给开口曲线的终点打掩护。`src/theme.css` 同步改：`.uni-acc-dot` 的
  fill、六段 `t0~t5` 的笔宽、`--uni-acc-floor`（.34 / 亮档 .42）与「留底亮度」注释全部删除，
  换成 `.uni-acc-arc`（无填充 / 圆头 / 1.15 笔宽）、`.uni-acc-arc-head`（亮色 + 1.3）、
  `.uni-acc-arc-tail`（1.0）三条规则；官方那两枚 `r = 9.5` 的圆仍只在 `:has(> g.uni-acc)`
  成立时隐藏，盒子仍是 16px。门禁：`selfcheck` 的 `css.18` 与 `acc.2` 整段重写（钉 RING /
  CX / CY / CYCLE / ARC_MIN / ARC_MAX / HEAD / WOBBLE / TAIL_DECAY / STILL_T，逐条钉
  `turn` / `span` / `glow` / `head` / `arc` / `path` / `segments`，并反向断言 18 个旧机制名字
  一个都不许回来），120 断言全绿；`npm test` 的 Accretion 套件 A1~A15 整段重写（闭环几何、
  四段首尾相接、头段 40% 弧长误差 < 1%、逐帧头端位移 < 0.6 设计单位、reduced-motion 只画一帧
  且不留 RAF 循环），五套 83 通过；`client.js` 重建 188103 chars（boot mark `uni-boot/f3f0ba73`），
  `build-client --check` 与 src 一致。

- **交接层改成会动的 ghost：上一代尾迹每帧向中心收缩（2026-11-01 第七十四轮）。** 用户逐字：
  「采用方案 3：回到单流，并用会动的 ghost；换轮时那 0.25 轮里，上一代尾迹每帧重新计算，
  并持续向中心收缩，屏幕上始终只显示一颗点」。双流那条路（相位交错两颗点）整条撤掉，回到
  单流；接缝不再靠一张静止快照顶着 —— `uniAccretionGhostD` 的缓存几何与 `UNI_ACC_GHOST_D`
  一起删除，新增 `uniAccretionRemnant(tail)`：从落点 `u = 1` 采回到 `tail`，窗口内
  `tail = u / UNI_ACC_RESIDUE_FADE` 从 0 涨到 1，六段 `d` 与 `stroke-opacity` 每帧一起重写，
  于是外端持续往中心收、窗口走完退成一个点、整层 `display: none`。
  逐段亮度仍是 `uniAccretionBandAlpha(i, 1)` 起淡（只减不增，接缝逐段相等），中心仍然不画点。
  门禁：`acc.2` 增钉 `uniAccretionRemnant(tail)`、`uniAccretionRemnant(u / UNI_ACC_RESIDUE_FADE)`、
  每帧重写 `d`，并反向断言 `UNI_ACC_GHOST_D` 不许回来；A7 改成验证「窗口第一帧仍是 u = 1 的
  整条曲线、外端随 tail 单调收缩、tail = 1 退成零长」，新增 A15 在挂载动画里验证「窗口内总长
  变短、窗口外整层收掉」；`npm test` 82 通过，`build-client --check` 与 src 一致。

- **交接窗口收窄（2026-11-01 第七十三轮）。** 用户逐字：「先改动 UNI_ACC_RESIDUE_FADE
  我看看，不行再让 ghost 也动起来。」`UNI_ACC_RESIDUE_FADE` 0.55 → 0.32：残影层原本要
  陪新一轮的点走到中途（约 715ms）才散，同屏两条螺旋的时长够长到读成「两个不同的螺旋」；
  收到 0.32（约 416ms）后旧图在新尾迹长到中段之前退干净，终点只剩一条完整螺旋、一个头。
  交接层仍是静止快照，只改淡出长度，不动架构。门禁：`selfcheck` 的 `acc.2` 增钉
  `UNI_ACC_RESIDUE_FADE = 0.32`（120 断言全绿）；`npm test` 里交接窗口的区间断言
  （`0.3 < fade < 0.8`）与 `hand(i, fade) === 0` 边界仍成立，82 通过；
  `build-client --check` 与 src 一致。

- **会话行 running 的吸积流补齐出生段与体积变化（2026-11-01 第七十二轮）。** 用户逐字：
  「修复 uniAccretionDotAlpha 在 u = 0 和 u = 1 时的非零硬跳变……当 u = 0.06（仅 78ms）时，
  外圈光点就已经 100% 满亮了，太快了，像闪现一样。」三条：① `UNI_ACC_BORN` 0.06 → 0.18
  （约 234ms），出生段变慢，光点从外圈缓缓凝聚出来；② `draw()` 新增出生包络
  `birthEnv = u < UNI_ACC_BORN ? u / UNI_ACC_BORN : 1`，六段尾巴的 `stroke-opacity` 改成
  `uniAccretionBandAlpha(i, death) × birthEnv` —— 原先只压收尾，`u = 0.01` 时外圈刚露头的 `t0`
  就是 0.55，而内圈交接层只剩 0.19，新旧尾巴在同一帧硬切；乘上之后新周期前 234ms 是外圈渐亮、
  内圈 ghost 渐暗的交叉淡入淡出；③ 光点半径改成
  `UNI_ACC_DOT × (0.35 + 0.65 × birthEnv) × (1 − 0.65 × death)`：外圈从 0.35 倍长到 1 倍，
  落进中心缩回 0.35 倍，体积与亮度一起变，位置跳变读起来轻。门禁：`selfcheck` 的 `acc.2` 增钉
  `UNI_ACC_BORN = 0.18`、`birthEnv` 那一行、`× birthEnv` 与半径公式（仍 120 断言全绿）；
  `npm test` 新增 A14 —— 接缝处 `t0` 掉到近零后逐帧爬回 0.55（单帧涨幅 < 0.12，不是一帧跳满），
  半径中段回到 1.1、两端缩到 ≈ 0.385；五套 82 通过；`build-client --check` 与 src 一致
  （191792 chars）。

- **输入卡的换页转场（2026-11-01 第七十一轮）。** 用户逐字：「现在输入框在新会话页到对话页的
  转场中没有动画，是直接从原地消失然后在底部出现，我想加一个动画。」根因在宿主，不在本主题：
  新会话页靠 `[data-phase=hero] .scrollBody{justify-content:center}` 把卡片居中，对话页靠
  `.composerSeat{position:sticky;bottom:0}` 把它钉在底，中间的 settling 相位又被
  `.root[data-phase=settling] .composerSeat{visibility:hidden}` 整块藏掉 —— 两个位置之间没有
  任何一帧过渡。① 新增 `src/runtime/composer-transition.js`（`mountComposerTransition()`，
  FLIP：hero 页记卡片矩形，相位翻到 active 时以矩形差为起始 transform，位移 + 淡入归零；反向
  对称；`data-uni-motion=reduced` 时不播；动画对象是 `[data-composer-card]` 而非带渐变底的
  `[data-composer-seat]`）。观察器只在 hero 页量矩形，流式消息产生的 childList 变更不排帧。
  ② 挂进 `src/client.js` 的 paint-layer effect（与 `mountHoverGravity` / `mountAccretion` 同挂，
  不新增 effect），`tools/build-contract.mjs` 的 `CLIENT_FILES` 加一项。③ 门禁：`selfcheck`
  120 断言全绿，`npm test` 75 通过；假 DOM 夹具验到正向 `-500px`、反向 `+500px`、中点走一半、
  reduce 时零次 `animate`、dispose 摘干净。

- **输入卡的转场与黑洞运镜同步（2026-11-01 第七十一轮，用户逐字：「跟黑洞的转场同步好不。」）。**
  原来按 300ms + `cubic-bezier(0.22, 1, 0.36, 1)` 落地；现在与黑洞那次运镜同 1000ms、同曲线：
  `src/client.js` 的 `MOVE_MS` 与 `black-hole.js` 的 12 段 `easeInOutCubic` 烘焙是关键帧的同一份
  算法（每段标 `linear`），不用 `cubic-bezier` 近似 —— 近似曲线与烘焙曲线在中段差出半帧，两处
  一起看读作「没同步」。洞抬起的那 64px 弧线（`ARC_BOW`）不跟：卡片是矩形控件，走弧线读起来是
  抖动，只同步时长与节奏。两处时长配套，改一个就要改另一个。

### Removed

- **主题的字体改动整份移除（2026-10-31 第六十三轮）。** 用户逐字：「去掉本主题的字体修改。」，
  随后确认「除了品牌字标先全部去掉」。① 令牌：`--dsw-font-family`（Tiempos 衬线栈）与
  `--ds-font-family-code`（Operator Mono 等宽栈）从 `tokens.json` / `src/tokens.json` 删除，
  55 → 53 个（A 41 + B 12），`meta.tokenCount`、`token-audit` 的 `PLANNED` 与 `selfcheck` 的
  tok.1 同步。② 样式：`src/theme.css` 删掉第三十六、三十七轮整块（CP Caret Metric 光标度量与
  `body [data-composer-input]` 字族规则），第三十五轮 D75 与 D104 注释改写为历史。品牌字标不动：
  `[data-slot='sidebar.brand.name']` 与 SYSTEM 芯片的 Bahnschrift/DIN 栈是 CSS 按名引用，
  不涉及随包字体。③ 资产与构建：`build/fonts.json`、`build/great-vibes-latin.woff2`、
  `build/great-vibes-OFL.txt` 移入回收站；`tools/build-client.mjs` 不再生成 `@font-face`、
  不再写 `MANIFEST.fonts`；`tools/measure-resources.mjs` 只量品牌 SVG。④ 门禁：`selfcheck`
  删 font.1/2/3 一组，tok.1 断言 53，暗色摘要因键集变化重算为 `7a5f014341e6814d`。⑤ 许可：
  `LICENSE` 2.1 与 `NOTICE` 1 改为「不再随包分发字体」，`package.json` 的 license 去掉
  OFL-1.1，两份 README 的字体声明同步。

### Changed

- **品牌三件套的 hover 彻底解耦：按钮不再整体缩，SYSTEM 只在指针越过字标右缘之后才响应（2026-10-31 第七十轮）。**
  用户逐字：「鼠标悬停在左栏顶部的三个品牌标识时仍存在区域使得悬停在某个范围时三个品牌标识同时缩小，
  请修改，使得品牌Logo、「WHALE-01」和「SYSTEM」三处互相独立互不影响。」。两个漏点：① `src/theme.css`
  第五十七轮那条引力兜底 `body[data-uni-motion] [data-uni-grav]:where(…)` 没带上 2479 行
  `button:not(:has([data-slot='sidebar.brand.name']))` 的排除，指针落在 SYSTEM 标签、两个 SPAN 之间的 gap
  或按钮左右 padding 时，`src/runtime/gravity.js` 把 `data-uni-grav` 挂到按钮本身，整条品牌按钮缩 0.97，
  头像、WHALE-01、SYSTEM 三件一起缩；② `button[…][data-uni-grav]::after` 那条只看按钮有没有属性，
  所以 gap 空白也会缩 SYSTEM。改法：兜底补 `:not(:is(button:has([data-slot='sidebar.brand.name'])))`
  （仍包在 `:where()` 里，不贡献权重，压不过任何角色细则）；`gravity.js` 新增 `BRAND_BUTTON` /
  `BRAND_NAME` 两个常量与两处判定 —— `onOver` 在指针未越过 name 右缘时干脆不挂属性，`measure()` 把按钮
  命中盒左界收到 name 右缘，指针左移进 gap 时 `holds()` 立刻失效并 drop。三区此后各缩各的：
  Logo `0.9`、WHALE-01 `0.97`、SYSTEM `::after 0.9`，按钮自身任何情况下都是 `1`。真机验证
  （19388 实例，CDP 逐点 `dispatchMouseEvent` + 读 `getComputedStyle().scale`）七个采样点全部符合预期：
  logo `0.9/1/1`、gap `1/1/1`（无属性）、WHALE-01 `1/0.97/1`、name 右侧空白 `1/1/0.9`、
  SYSTEM `1/1/0.9`、按钮左 padding `0.9/1/1`。

- **会话行 running 的收尾只压不抬，中心那颗「已落底的点」撤掉（2026-10-31 第六十一、六十二轮）。**
  用户逐字：「撤销A，我找到问题所在了，绿点走完全程后它所走过的轨迹会突然亮一下再变暗，
  这才是问题所在。」。病根是留底的方向：六段自然亮度 `0.55 / 0.34 / 0.2 / 0.12 / 0.07 / 0.04`，
  而收尾时每段被插值到 `floor = 0.34`（暗档），于是走过去的内圈段被抬亮 —— 第 5 段 `0.04 → 0.34`
  是 8.5 倍、第 4 段 4.9 倍、第 3 段 2.8 倍。点落底那一刻整条轨迹被拉成一条均匀 0.34 的暗绿螺旋
  （＝「突然亮一下」），随后残影层再在 715ms 里把它淡掉（＝「再变暗」）。`/grilling` 一问定案
  （m01594 选 A）：留底改成**乘**，`uniAccretionBandAlpha` 改成 `UNI_ACC_END + (1 - UNI_ACC_END) ×
  级联权重`（`UNI_ACC_END = 0.35`），每段按自身亮度等比压暗，整幅总墨量单调不增，年龄顺序全程
  不被抬乱；`floor` 只留给那颗点。① 残影层与交接层合并成一层：原来的整曲线 `.uni-acc-residue`
  路径删除，改用 `uniAccretionHandoffAlpha(index, u)` 逐段从「它自己收尾时的亮度」二次方淡出
  （一轮的前 55%），接缝处逐段相等，交接那一帧画面不变。`UNI_ACC_HANDOFF_DIM` 随之删除 ——
  旧一代不再额外乘系数。② 用户 m01745「去掉绿点到达终点后在中心位置闪一下的绿点」：交接层只留
  形状，停在 `(7, 8)` 的那颗 `ghostDot` 与 `uniAccretionHandoffDot` 一并删掉，`UNI_ACC_HANDOFF`
  这个「点留多久」的窗口也消失，整层由逐段维护。③ `selfcheck` 增钉「不许出现 `uniAccretionHandoffDot`
  / `ghostDot` / `UNI_ACC_HANDOFF`」「交接层不得被整组 opacity 二次压暗」「`uni-acc-residue` 不得
  回来」；测试改成 A4「收尾是压暗、六段不归零、总墨量只减」、A6「任何一段任何时刻都不许超过自身
  亮度」、A7「逐段从收尾亮度起淡、窗口外为零、几何等于整条曲线、不再交接第二颗点」。门禁：
  `selfcheck` 123 断言 0 失败、`node --test` 五套 69 通过、`build-client --check` 与 src 一致
  （232352 chars）。

- **会话行 running 的交接改成两代同屏，绿点不再从内圈瞬移回外圈（2026-10-31 第六十轮）。**
  用户逐字：「绿点从最外圈进到内圈后消失，然后外圈重新出现绿圈开始运动，这个过程会导致绿点
  看起来突然从内圈跳到外圈，有突兀感」。这是单粒子的结构性代价：同一时刻只有一个亮点，它要
  从最里圈回到最外圈，眼睛只能后退着跟一次 saccade，亮度上留多少底都盖不住，因为盖不住的是
  位置的主体。grilling 定案（`/grilling` 四问，B / A / B / B）：只在交接处交叠。① 一轮走完
  后，上一轮的**终态**（六段螺旋 + 停在中心的点）在画面上多留 `UNI_ACC_HANDOFF = 0.22` 轮
  （约 286ms），期间新一轮的点已经从外圈亮起来 —— 两个主体同时在场，不存在瞬移。窗口之外
  整组 `display: none`，不参与渲染，其余时间仍只有一颗点在内旋。② 时序是「新点先亮、旧点
  后熄」：新点沿用 78ms 快速登场（读作「又落进来一颗」），旧点保持 floor 亮度再由整组
  opacity 线性淡出。故意**不做**总亮度守恒 —— 那是交叉淡入，人眼会读成「点从中心滑向外圈」，
  与吸积语义相反。③ 窗口里旧一代的六段尾巴乘 `UNI_ACC_HANDOFF_DIM = 0.45`，退成背景纹理；
  不压的话 16px 下两条同亮度螺旋会糊成一团。旧一代的点不受这个系数影响。④ 终态那一幅的几何
  每轮相同，在 `uniAccretionGhostD()` 里算一次缓存，窗口里只改一条 `opacity`。第一圈之前不画
  幽灵（新挂上来的行不该先出现一条它没走过的螺旋），`prefers-reduced-motion` 的静态帧也仍是
  单点形态（用户 m01429 选 B：两颗点会读成两个彼此无关的墨点）。`acc.2` 增钉两个常量与幽灵
  接线，新增 A7 钉「窗口长度、首圈不画、窗口内单调淡出、窗口外为零、终态六段首尾相接且等于
  整条曲线」。门禁：`selfcheck` 123 断言 0 失败、`node --test` 五套 69 通过、`build-client
  --check` 与 src 一致（232324 chars）。

- **会话行 running 的中断是几何清零，改用残影层接上（2026-10-31 第五十九轮）。**
  用户逐字：「还是不对，现在没有连贯感，我想要的是视觉连贯，现在还是有中断。」上一轮修的是
  亮度，这一轮找到的是形状：一轮走完，六段折线的 `d` 变成空串 —— 整条螺旋在同一帧里消失、
  下一帧再从零长出来，同时点从中心跳回外圈。亮度连续挡不住这个跳变，因为画面上根本没有了
  一条连续的线。① 新增残影层 `.uni-acc-residue`：几何固定写死为整条曲线（`uniAccretionFullD`
  只算一次），每帧只改 `opacity`，在一轮的前 `55%`（约 715ms）里从 floor 二次方淡出到 0。
  它排在六段之下、笔宽 `.62`，所以「上一轮结尾」与「下一轮残影」是同一亮度、同一条曲线，
  交接那一帧画面完全不变，只有点在换位置。② 六段尾巴不再有任何一段归零：`uniAccretionBandAlpha`
  改成在 floor 与年龄亮度之间按级联权重插值（`floor + (age - floor) * weight`），`death = 1`
  时六段全部落在 floor 上。先乘后加会写错 —— 「年龄 × 权重 + floor」会让头段先掉到
  `floor × 0.55` 再回升，读作闪一下。③ 点也两头压在 floor 上：`uniAccretionDotAlpha` 改成
  `(u, death, floor)`，用 `born = u / UNI_ACC_BORN`（`0.06`）与 `dying = 1 - death` 取较小值，
  `dot(0, 0) === dot(1, 1) === floor`，接缝处是同一个数。④ 整组不再压 `opacity`：`paint` 里
  `row.g.style.opacity` 固定为 `1`，否则 floor 起手会被乘成 `floor²`，交接处反而变暗。
  `css.18`、`acc.2` 相应钉住残影层的类名、笔宽与 `uniAccretionResidueAlpha` 的接线，A4 重写为
  「六段都落到 floor、每段朝 floor 单调」、A5 重写为「两头上限一致、接缝不跳」、新增 A6 钉
  「残影从上一轮的亮度起手、单调淡出、窗口之后为 0」。门禁：`selfcheck` 123 断言 0 失败、
  `node --test` 五套 68 通过、`build-client --check` 与 src 一致（230059 chars）。

- **会话行 running 的黑帧真的修掉了：绿点自己也留底，不只尾巴（2026-10-31 第五十八轮）。**
  用户逐字：「还是有一瞬的全黑」。上一轮只让最老那段尾巴留底，漏了点本身 —— 点的亮度挂在
  `rank = 0` 的级联权重上，`death` 走到 `0.55`（即 `u ≈ 0.91`）就归零，收尾那 117ms 里屏幕
  上只剩最外一小段 5.5px 长、0.71px 宽、亮度 `.22` 的弧，16px 下读作黑。① 新增
  `uniAccretionDotAlpha(death, floor)`：点从头部亮度 `.55` 一路收到 `floor`，从不归零；它与
  尾巴的级联不是同一套规则 —— 段是「被吞掉的尾巴」，点是被吞掉的粒子。② 留底亮度抬档：
  暗 `.22 → .34`、亮 `.30 → .42`（`--uni-acc-floor` 两处，JS 兜底同步到 `.34`），`.22` 在绿
  底上仍偏弱。③ 静态帧把点补回满亮（动态里 `.55` 是「即将交接」的亮度，兜底帧没有下一轮，
  不该跟着压暗）。`css.18` 改钉两档新 floor，`acc.2` 加 `uniAccretionDotAlpha` 的存在与调用
  断言，新增 A5 钉「点单调收到 floor、全程不低于 floor、不越界」，A4 的 floor 换成新值。
  门禁：`selfcheck` 123 断言 0 失败、`node --test` 67 通过、`build-client --check` 与 src
  一致（229232 chars）。

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
