/* Renders the production component's SVG tree without a second drawing. */
import vm from 'node:vm'
import { readFileSync, writeFileSync } from 'node:fs'
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')
let next = 0
const context = vm.createContext({ require: () => ({
  useId: () => ':preview:' + (++next) + ':',
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
}) })
vm.runInContext(read('src/runtime/brand-logo-geometry.js') + '\n' + read('src/runtime/brand-logo.js'), context)
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
const names = { className: 'class', strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeDasharray: 'stroke-dasharray' }
function html(node) {
  if (node == null || node === false) return ''
  if (typeof node !== 'object') return escape(node)
  const attrs = Object.entries(node.props).filter(([, value]) => value !== undefined).map(([key, value]) => {
    if (key === 'style') value = Object.entries(value).map(([k, v]) => k.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase()) + ':' + v).join(';')
    return (names[key] || key) + '="' + escape(value) + '"'
  }).join(' ')
  return '<' + node.type + ' ' + attrs + '>' + node.children.map(html).join('') + '</' + node.type + '>'
}
const sizes = [16, 20, 24, 32, 48]
function section(dark) {
  return '<section class="' + (dark ? 'dark' : 'light') + '"><h2>' + (dark ? '深色' : '浅色') + '</h2>' + [true, false].map(animated => '<h3>' + (animated ? '局部流动 · 10 秒' : 'animated=false · 静态') + '</h3><div class="samples">' + sizes.map(size => '<figure>' + html(context.UniverseBrandLogo.component({ size, animated })) + '<figcaption>' + size + ' px</figcaption></figure>').join('') + '</div>').join('') + '</section>'
}
const source = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>黑洞品牌 Logo 验证</title><style>' + read('src/brand-logo.css') + '\nbody{margin:0;padding:32px;font:14px system-ui;background:#888}main{max-width:900px;margin:auto}h1{color:white;font-size:23px}section{padding:24px;margin:16px 0;border-radius:8px}.dark{background:#111720;color:#cfd5dc}.light{background:#faf9f4;color:#25231b}h2{margin:0 0 20px}h3{font-size:13px;font-weight:400}.samples{display:flex;align-items:center;gap:32px}figure{margin:0;width:80px;height:82px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px}figcaption{font-size:12px}</style><main><h1>黑洞品牌 Logo · 实际像素尺寸</h1><p>由生产组件生成。此页验证 SVG/CSS，不模拟 DSH 布局。</p>' + section(true) + section(false) + '</main></html>'
writeFileSync(new URL('../preview/brand-logo.html', import.meta.url), source)
console.log('wrote preview/brand-logo.html (20 instances, production SVG/CSS)')
