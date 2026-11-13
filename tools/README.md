# tools/ 索引

`tools/` 里有三类东西，用途完全不同，别混着看。

## 1. 门禁与构建（`package.json` 的 scripts 调用）

| 文件 | 作用 |
| --- | --- |
| `build-client.mjs` | 构建入口：按 `CLIENT_FILES` 顺序拼接出 `client.js`；`--check` 只比对磁盘产物 |
| `build-contract.mjs` | `CLIENT_FILES` 清单、`resolveBuild`/mode、发布契约；被构建、verify、测试共用 |
| `source-transforms.mjs` | 去块注释、换行归一化、`minifyCss`（窄用途，不是通用压缩器） |
| `verify.mjs` | 串行门禁：`--check` index/client → 两个测试 → `selfcheck` → `token-audit` → 构建同步检查 |
| `selfcheck.mjs` | 127 项静态断言（CSS 逐字节、token/行号等价等） |
| `token-audit.mjs` | token 审计 |
| `audit-evidence.mjs` | 证据输入校验，`token-audit` 与 `build-contract.test.mjs` 共用 |
| `measure-resources.mjs` | 产物字节数、gzip/brotli、Node 内编译耗时 |
| `effort-fixture.mjs` | `runtime.test.mjs` 的 picker 测试夹层 |

## 2. 测试（`node --test`）

`runtime.test.mjs`、`build-contract.test.mjs`、`black-hole.test.mjs`、`dialog-arc.test.mjs`、`brand-logo.test.mjs`。

## 3. 随 npm 包发布（仅这三个）

`build-client.mjs`、`build-contract.mjs`、`source-transforms.mjs` —— 供 `prepare` 在 git 安装时重建 `client.js`。其余 `tools/*.mjs` 不进包。

## 4. 历史溯源（不参与门禁，勿删勿挪）

- `probe*.py`（8 个）、`s2-*.py`（14 个）、`s3-*.py`（4 个）、`s4-reconcile.py`、`s6-verify.py`、`verify-*.py`（2 个），共 30 个。

这些是 S1–S10 设计轮的复算脚本，`docs/*.md` 里大量引用其命令；移动或删除会让文档里的复算步骤失效。

## 5. 人工预览工具（不进门禁）

`build-black-hole-preview.mjs`、`build-brand-logo-preview.mjs`、`gpu-browser-check.js` —— 手动运行。
