import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url)
const html = readFileSync(new URL('preview/deep-space.html', root), 'utf8')
const source = readFileSync(new URL('src/runtime/deep-space.js', root), 'utf8')
mkdirSync(new URL('out/', root), { recursive: true })
const target = new URL('out/deep-space-preview.html', root)
writeFileSync(target, html.replace('<script src="../src/runtime/deep-space.js"></script>', () => '<script>\n' + source.replace(/<\/script/gi, '<\\/script') + '\n</script>'))
console.log('Deep-space preview: ' + fileURLToPath(target))
