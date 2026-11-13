# dsh-quasar-theme 代码优化 · 设计树笔记

> 本文件记录 `/grilling` 逐轮问答确定的设计树与决策。每轮更新，勿在未确认前动手实现。

## 硬约束

- **外观零改动**：颜色、令牌值、选择器、DOM 结构、class/data 属性、时序语义任何可见结果都不得变。
- 中文、直接陈述；事实自查证，决定交用户裁决；一次只问一题。

## 基线事实（2026-11-07 摸底）

- 版本 v0.1.7，`main` 与 `origin/main` 同步。
- 源码：`src/client.js` 675 行（装配胶水），`src/runtime/` 约 4300 行/20 文件（黑洞·吸积盘·引力透镜物理、glass、pins 等），`src/theme.css` 3555 行（paint 层，手写，注释即文档），`src/model-effort-picker.css` 712 行，`src/tokens.json`（53 token 源）。
- 产物 `client.js` 283 KB；体积大头是 base64 壁纸+字体资源（约 441KB+281KB 文本），非逻辑代码。
- 现有门禁：`npm run verify`（selfcheck 127 项静态断言，含 cli.13 CSS 逐字节等价、token/行号等价、构建同步），`npm test`（25 项 Node 行为测试），另有 `audit`、`measure:resources`。
- 生成束被 git 忽略；`npm run build` 经 `tools/build-client.mjs` 生成。

## 设计树（第 1 轮已定）

- **根：本轮优化目标维度** → 用户：A/B/C/D 全做，分轮，先 A。
  - A 可维护性/可读性（先做）
  - B 运行时性能（后续轮）
  - C 产物体积（后续轮；注意大头是资源，碰资源=碰外观）
  - D 构建/工程流程（后续轮）
- 每轮 = 一个可独立验收的单元；一轮一轮来。

## 已定：A 阶段边界与验收红线（Q2 同意）

- 可改：仅 JS 逻辑（src/client.js、src/runtime/*.js、src/model-effort-picker.js）。
- 不动：src/theme.css、src/tokens.json、src/*.css、build/ 资源、任何颜色/数值/选择器；对外契约（exports/inject/apply/DOM/class/data/时序）不变。
- 验收：`npm run verify` + `npm test` 全绿；`git diff --stat` 只含 .js（若抽取改到函数名/内容导致 selfcheck 内容断言失效，只允许同步更新 tools/ 门禁，且不改 CSS/token 产物）；重建后束内 CSS 段与 token 段逐字节等于改前（用改前备份 client.js 对比）；截图 diff 作可选保险。

## A 阶段勘察结论（事实）

- 死代码：全仓仅 `src/runtime/brand-logo-geometry.js` 一个符号未被引用，且它本就在 CLIENT_FILES 之外、不进包，是「留作回退」的有意保留，不宜删。
- 重复：glass.js↔lens.js 39 个 8 行重复窗口（共享 host-svg/filter/ResizeObserver/scan/mounted/mounts/teardown 整套脚手架，真重复约 150–180 行）；accretion.js↔kepler.js 8 窗口；client.js↔composer-typed.js 9 窗口。
- 空文件：`src/runtime/selection.js` 22 行纯注释、0 代码，仅为 CLIENT_FILES 行号钉保留；其注释被构建剥离，删它不改产物。
- 最大手写文件：`src/model-effort-picker.js` 1138 行（内聚交互逻辑，无跨文件重复）。

## 已定：A 阶段四个单元全做，按 A1→A2→A3→A4 顺序（Q3）

- A1 glass.js↔lens.js 悬浮位移滤镜脚手架抽取 —— 已完成
- A2 accretion.js↔kepler.js 会话行 SVG 挂载脚手架（约 64 行）
- A3 删空壳 src/runtime/selection.js + 收 client.js↔composer-typed.js 9 窗口重复
- A4 model-effort-picker.js（1138 行）内部整理，需先勘察

## A1 结果（2026-11-07 完成）

- 新增 `src/runtime/displacement-mount.js`：`uniMountDisplacement(opts)` 承载整套 host-svg→filter/feImage/feDisplacementMap→ResizeObserver→scan→mounted→mounts→teardown 脚手架；顶层附 `uniTwo`、`uniPct`。
- `src/runtime/glass.js`、`src/runtime/lens.js` 重写为 thin wrapper：只保留 targets 与 `glassMap`/`lensMap`（映射算法原样不动），通过 opts 钩子（hostId/mapName/targets/init/key/draw）调共享脚手架。
- `tools/build-contract.mjs` CLIENT_FILES 插入 `displacement-mount.js`（mutation-records 之后、glass/lens 之前）；`tools/build-contract.test.mjs` 加顺序断言；`tools/runtime.test.mjs` glassFixture 改为 `withFilterIds(upTo(glass) + read(glass))`（filter 建立代码已移入共享文件）。
- 净删约 338 行（glass −192、lens −146）。
- 验收：`npm run build` 成功（client.js 280450 chars / 53 token）；`npm run verify` exit 0；`npm test` 121 pass 0 fail；重建束内 TOKENS/MANIFEST/CSS 三行 sha256 与改前完全一致；假 DOM 逐尺寸（380×56/240×60/200×40）5 目标位移图 image href 改前改后全等。
- 备份：`dsh-quasar-theme-A1-20261107-223543`（备份目录，用时从备份处取）。

## A2 结果（2026-11-07 完成）

- 新增 `src/runtime/status-row-mount.js`：`uniStatusRowMount(opts)` 承载会话行状态 SVG 动画的公共骨架——环境守卫、nowMs、isReduced、make、sync（querySelectorAll → rows 对账 → attach/摘除）、MutationObserver 双观察器（文档子树 + body 的 data-uni-motion）、prefers-reduced-motion、teardown、首帧启动。opts 钩子：select/find/needsAttach/attach/detach/frame/init/watchReducedMedia。
- `src/runtime/accretion.js`、`src/runtime/kepler.js` 只保留各自的几何、attach、paint/paintStill，通过钩子接入共享骨架；逐帧语义（accretion 的 dirty-sync + 静态/空行退出、kepler 的 30 帧兜底 + isConnected 跳过 + 单帧只格式化一次）原样保留在各自 frame 钩子里。
- `tools/build-contract.mjs` CLIENT_FILES 在 selection.js 之后、accretion.js 之前插入 `status-row-mount.js`；`tools/build-contract.test.mjs` 补存在性 + 顺序断言。
- 行数：accretion.js 331→225、kepler.js 299→209（净删约 104 行），加共享文件 146 行，总体略减。
- 验收：`npm run build` 成功（client.js 279295 chars / 53 token）；`npm run verify` 113 断言 0 失败；`npm test` 121 pass 0 fail（A11–A19、K1–K8、M1、S10 全绿）。
- 产物对比：改前后第 85 行 TOKENS、87 行 MANIFEST、89 行 WALLPAPER_DECLARATIONS、91 行 CSS 四行 sha256 完全一致；首个差异行 4369，之后全部落在 runtime JS 区。
- 备份：`dsh-quasar-theme-A2-20261107-224307`（备份目录，用时从备份处取）。

## A3 结果（2026-11-07 完成）

- 删除空壳 `src/runtime/selection.js`（21 行纯注释、0 代码）：已移入回收站（未用 rm），并从 `tools/build-contract.mjs` 的 `CLIENT_FILES` 移除该项。它是纯注释，构建时被剥成空行，删除不改变产物任何非空行。
- 收掉 `src/client.js` 与 `src/runtime/composer-typed.js` 的重复文档块：client.js 里那段 Round 65 大注释（35 行，讲 Lexical 编辑器判定空文本、三事件、按帧批读）与 composer-typed.js 文件头注释逐段重复，属于抽取后残留。client.js 只留两行指针，完整说明仍在 composer-typed.js。
- 验收：`npm run build` OK（client.js 279240 chars / 279612 bytes / 53 token）；`npm run verify` exit 0（client.js 与 src 同步）；`npm test` 121 pass 0 fail。
- 产物对比（对 A3 前产物）：全部 3969 行非空行**逐字节相同**（`identical=true`），差异仅两段空行（4330–4350 对应删掉的 selection.js 21 行注释、6013–6046 对应删掉的 client.js 35 行注释，构建把注释剥成空行）；第 85 TOKENS、87 MANIFEST、89 WALLPAPER_DECLARATIONS、91 CSS 四行 sha256 不变。
- `git status`：M src/client.js、D src/runtime/selection.js、M tools/build-contract.mjs；其余为前两轮改动。
- 备份：`dsh-quasar-theme-A3-20261107-224900`（备份目录，用时从备份处取）。

## A4 结果（2026-11-07 完成，范围 B+C+A）

- 只动内部样板，不动任何 DOM/class/属性/时序/文案/CSS。按用户选定做 B（提交尾部）+ C（pending 应用）+ A（键盘骨架），不做 D（currentEntry 合并）与注释清理（292 行注释是设计树，构建时已剥离）。
- 新增 3 个模块级 helper（都在 model/effort 构造器之前）：
  - `setRowsDisabled(rows, pending)`：统一两端的行禁用写入（先读后写，避免稳定通知触发多余布局）。
  - `commit(opts, instance, payload)`：`select → setOpen(false) → trigger.focus()` 的唯一实现；两端的“能否选择”守卫仍留在各自调用点（model 看 pending，effort 还要看 current）。
  - `roveKeys(event, panel, rows, hooks)`：Tab 陷阱 / Enter·Space 激活 / 上下与 Home·End 走焦点环，返回是否已消费；model 用 `skipActivate` 让搜索框放行，并保留自己的 Left/Right 折叠分组补充键。
- 替换点：model 的 `applyPending` 循环、effort 的 signature-equal 内联 pending 循环、两处 `choose` 尾部、两处 `onKey`。
- 行数：1138 → 1143（+5）。这是“去重”而非“减行”：键盘与焦点策略只剩一处定义，未来改一处两端同步，不再各写一份。
- 产物对比：picker 插值区 1084 → 1089 行；束内 149 行前缀 + 4786 行后缀逐行完全相同，即除 picker 段外零变化；第 85 TOKENS、87 MANIFEST、89 WALLPAPER_DECLARATIONS、91 CSS 四行 sha256 与改前一致。
- 验收：`npm run build` OK（client.js 279142 chars / 279514 bytes / 53 token）；`npm run verify` exit 0；`npm test` 121 pass 0 fail。
- 门禁同步（未放宽任何断言）：`tools/effort-fixture.mjs` 现在从源码切出 `rove/step/trapTab` 与三个新 helper 一起 eval（+4 行，仍跑生产源码）；`tools/runtime.test.mjs` 的 S5 切片前置 `roveKeys` 源码并补 `shell`/`rows` 上下文（+11 行，ArrowLeft 断言不变）。
- 备份：`dsh-quasar-theme-A4-20261107-225726`（备份目录；含 src/model-effort-picker.js、client.js.before）。

## B 阶段勘察（2026-11-07，只读，未改代码）

方法：grep 全 `src/` 的性能敏感面（rAF/setInterval、强制布局读、observer/事件监听），再逐个读热路径：`gravity.js`、`panels.js`、`status-row-mount.js`、`accretion.js`、`kepler.js`、`accretion-disk.js`、`hole.js`、`client.js`、`model-effort-picker.js`。

结论：**没有发现「每帧都强制布局」的硬伤**。GPU 画布（accretion-disk/hole）只在 resize/pose 读矩形，帧内只提交绘制；SVG 行动画每帧只写属性、不读布局；picker 的 fitText 已用「读值再写 + 每串缓存 + 3 遍预算」挡住回环。风险集中在**事件频率**，不在帧循环。

候选（按预期收益 / 风险排序）：
1. `src/runtime/gravity.js:91-109` `pointerTarget()`：capture 阶段 `pointerover` 每次最多 8 层祖先 `getComputedStyle`（未命中 TARGETS 的普通文本/容器都会走）。事件频率最高的一处。
2. `src/runtime/gravity.js:207-212,218` 与 `src/runtime/panels.js:127-131,167`：scroll capture 处理器每次都量 `getBoundingClientRect`/`offsetWidth`（未合并到 rAF 的仅 gravity；panels 已 schedule 到 rAF）。
3. `src/runtime/status-row-mount.js:105-113`：documentElement 子树 childList+attributes 观察器，聊天流式渲染期间回调量大（有 `uniStatusMutationTouches` 过滤）。
4. `src/runtime/accretion.js:170-177,210-223`：每帧按行拼 4 段 path `d` 字符串；只有 ongoing 行参与，行数少时微不足道。
5. `src/model-effort-picker.js:206-248,747-764`：已优化到位，仅 resize 重排与标签变化时有余量。

不建议动：accretion-disk/hole 的 GPU 路径（帧预算已由 `config.fps` 节流，`stats()` 已暴露 meanPaintMs/rAFGapMs）；kepler 每帧只算一次坐标；client.js 的 idle 延迟加载。

指标草案（B 的验收必须先量化）：PerformanceObserver('longtask') 统计 >50ms 任务数与总时长；现有 `accretionDisk.stats()` 的 meanPaintMs/maxPaintMs/rAFGapMs；新增诊断计数器（pointerover 次数、每次 measure 调用数、scroll 处理器触发数），仅诊断构建用，不进产物。场景：悬停按钮群、滚动长会话、打开模型选择、开关面板。

待定：先仪表化测量，还是直接做低风险 P1（1+2）。

## B 阶段测量（2026-11-07，真实 Chromium + 真实 theme.css，无仓内代码改动）

沙盒：系统临时目录下的 `uni-perf/`。`bench.html` 加载真实 `theme.css` 与真实 `gravity.js`（script 标签，直接跑模块代码，非拷贝）；`bench2.html` 加载真实 `panels.js` + 3 个 `role="dialog"` 面板。用 MCP Chromium 在页面内 eval 真实模块并计时。

数字（中位）：
- `getComputedStyle` 单次 **4.2µs**；`getBoundingClientRect` 单次 **1.68µs**。
- gravity：一次 `pointerover` 平均 **18.8µs/元素**（600 元素一轮 11.3ms）；悬停中的 `pointermove` **7.1µs/次**。
- panels：3 个面板下滚动每帧 sweep **0.278ms**；一次完整量测（3 面板 gCS+rect+offsetWidth）**18µs**。

换算：真实鼠标 `pointerover` 约 20–60 次/秒 → gravity 合计 **0.4–1.1ms/秒**（≈0.05% CPU）。panels 只在「有对话框打开且正在滚动」时每帧 0.28ms（≈1.7% 帧预算）。

结论：所有热点在实际量级下 ≤0.3ms/帧、≤1ms/秒，**没有可测收益**。按 YAGNI 不建议改动。若将来出现真实卡顿（低端机 / 120Hz / 大量并发动画行），优先级仍是 panels sweep 与 gravity pointerover；届时先用同一沙盒复测再改。

未测：`status-row-mount` 观察器在真实聊天流下的回调频率——其单次代价与上述同量级，且需真实应用环境才能测，不单独造数。
- **B 结论（2026-11-07）**：已测、无可测收益，按 YAGNI 关闭，不写代码。测量沙盒已按 A2 移入回收站。

## D 结果（2026-11-07 完成，范围：索引 + 收窄发布清单）

- 新增 `tools/README.md`：把 tools/ 分成五类——门禁构建、测试、随包发布（仅 3 个 mjs）、历史溯源（30 个 py，docs 引用，勿删勿挪）、人工预览工具。
- `package.json` 的 `files`：`"tools/*.mjs"`（16 个 mjs、407KB 文本）→ 显式三项 `tools/build-client.mjs`、`tools/build-contract.mjs`、`tools/source-transforms.mjs`，外加 `tools/README.md`。理由是消费者只需要 `prepare` 能重建 client.js。
- 验证：`npm pack` 条目 50、packed 677786 B、unpacked 1330195 B；tools 条目 4 个（34664+3170+959+1911 B）。真实打包解到临时目录后跑 `node tools/build-client.mjs --check` → `OK (in sync with src/, 279142 chars, 53 tokens)`，说明 git 安装时 `prepare` 仍能自举。
- 未动 selfcheck.mjs（1718 行/127 断言）、runtime.test.mjs（1979 行）等门禁本体；30 个 py 溯源脚本保持原位。
- 备份：`dsh-quasar-theme-D-20261107-231726`（备份目录；含 package.json）。

## C 结果（2026-11-07 勘察后关闭，YAGNI）

只读测量，未改文件。client.js 279142 字符 / 279514 字节，gzip 108339 B。
构成：JS 逻辑 ≈172000（62%）、字体+品牌图 base64 69984（25.1%，字体 53936 + 图 16048）、主题 CSS 32014（11.5%，门禁逐字节锁定）、TOKENS+MANIFEST 3.6K + 上面那份 base64。

历史性能轮（perf round 4–7）已剥全部 JS 块注释、去行首缩进、压 CSS 空白，bundle 内只剩 4 行注释，常规优化无对象。剩余三条杠杆均不采用：
1. JS minify（terser/esbuild，未装）：估省 40–50K 字符 / gzip 10–14K；代价是击穿 selfcheck cli.21「bundle 逐字等于 stripBlockComments(src)」，必须改门禁，且 diff 不可读。
2. 品牌图 PNG→无损 WebP：12036→6434 B（−46%），但解码像素与 PNG 非逐字节一致（alpha 差异），碰外观红线；PNG optimize=True 无收益。
3. 字体子集化：Cinzel 6 处标题、EB Garamond 渲染正文含用户输入，子集化必缺字。

结论：C 关闭，产物体积视为达标。
