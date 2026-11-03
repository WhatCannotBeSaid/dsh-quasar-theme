import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const root = new URL('../', import.meta.url)
const html = readFileSync(new URL('preview/black-hole.html', root), 'utf8')
const source = readFileSync(new URL('src/runtime/geodesic.js', root), 'utf8') +
  readFileSync(new URL('src/runtime/accretion-disk.js', root), 'utf8')
mkdirSync(new URL('out/', root), { recursive: true })
const target = new URL('out/black-hole-preview.html', root)
const TAGS = '<script src="../src/runtime/geodesic.js"></script><script src="../src/runtime/accretion-disk.js"></script>'
writeFileSync(target, html.replace(TAGS, () => '<script>\n' + source.replace(/<\/script/gi, '<\\/script') + '\n</script>'))
console.log('ASCII preview: ' + fileURLToPath(target))
