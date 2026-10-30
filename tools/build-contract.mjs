import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

export const LOCAL_WALLPAPERS = 'out/wallpapers.local.json'
/* 品牌标（2026-10-27 第二版）：用户给的墨笔黑洞图，组件只负责盒子，图像在
 * `--cp-brand-mark` 里（tools/build-client.mjs 从 build/brand-mark-black-hole.png 内嵌）。
 * 原来的矢量几何文件 src/runtime/brand-logo-geometry.js 已不再被组件引用，也不再进包；
 * 文件本身留在盘上，需要回退到矢量方案时把这一行加回来即可。 */
export const CLIENT_FILES = ['src/runtime/black-hole.js', 'src/runtime/page-mode.js', 'src/runtime/brand-logo.js', 'src/runtime/glass.js', 'src/runtime/lens.js', 'src/runtime/pins.js', 'src/runtime/panels.js', 'src/client.js']

/* 品牌标的样式（遮罩 + currentColor）。它不在 src/theme.css 里，因为 paint layer 只接受
 * 「body/:root/#root + data-* 契约选择器」（selfcheck css.7），而组件自己的类是主题的内部
 * 约定，不该被那条门禁管；它在同一个 <style> 里，所以停用插件时和 paint layer 一起消失。 */
export const BRAND_LOGO_CSS_FILE = 'src/brand-logo.css'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function parseMode(args = []) {
  const choices = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--public') choices.push('public')
    else if (args[i] === '--mode') choices.push(args[++i])
    else if (args[i].startsWith('--mode=')) choices.push(args[i].slice(7))
  }
  if (choices.length > 1 || choices.some(mode => !['auto', 'public', 'local'].includes(mode))) {
    throw Error('Use exactly one --mode auto|public|local (--public is a legacy alias).')
  }
  return choices[0] ?? 'auto'
}

export function resolveBuild(root, args = []) {
  const requested = parseMode(args)
  const local = existsSync(join(root, LOCAL_WALLPAPERS))
  const mode = requested === 'auto' ? (local ? 'local' : 'public') : requested
  if (mode === 'local' && !local) throw Error('Local wallpaper manifest is missing; refusing to fall back to public.')
  const wallpaperManifest = mode === 'local' ? LOCAL_WALLPAPERS : 'build/wallpapers.json'
  return { mode, wallpaperManifest, wallpaperSha256: sha256(readFileSync(join(root, wallpaperManifest))) }
}

export function validateArtifact(source, expected) {
  const match = /var MANIFEST = (\{[^\n]+\})\n/.exec(source)
  const actual = match ? JSON.parse(match[1]).build : null
  if (!actual || Object.keys(expected).some(key => actual[key] !== expected[key])) {
    throw Error(`Artifact mode/input mismatch: expected ${expected.mode}; rebuild with --mode ${expected.mode}.`)
  }
  return actual
}
