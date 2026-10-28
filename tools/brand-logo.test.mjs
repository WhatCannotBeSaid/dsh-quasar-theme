import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')
function fixture() {
  const react = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat().filter(Boolean) }),
  }
  const context = vm.createContext({ require: name => { assert.equal(name, 'react'); return react } })
  vm.runInContext(read('src/runtime/brand-logo.js'), context)
  return { logo: context.UniverseBrandLogo }
}
test('brand: the mark is a square box at the requested size, 28 px by default', () => {
  const { logo } = fixture()
  for (const size of [16, 20, 28, 32, 48]) {
    const tree = logo.component({ size })
    assert.equal(tree.type, 'span')
    assert.equal(tree.props.style.width, size)
    assert.equal(tree.props.style.height, size)
    assert.ok(tree.props.className.split(' ').includes('uni-blist'))
    assert.ok(!JSON.stringify(tree).includes('NaN'))
  }
  assert.equal(logo.component().props.style.width, 28)
  // A size that is not a positive number falls back to the default instead of emitting NaN.
  for (const bad of [undefined, 0, -4, 'x', NaN]) assert.equal(logo.component({ size: bad }).props.style.width, 28)
})
test('brand: accessibility and className are opt-in, the mark stays decorative by default', () => {
  const { logo } = fixture()
  const labelled = logo.component({ title: '黑洞', className: 'custom' })
  assert.equal(labelled.props['aria-label'], '黑洞')
  assert.equal(labelled.props.role, 'img')
  assert.equal(labelled.props['aria-hidden'], undefined)
  assert.ok(labelled.props.className.includes('custom'))
  const plain = logo.component()
  assert.equal(plain.props['aria-hidden'], true)
  assert.equal(plain.props.role, undefined)
  assert.equal(plain.props['aria-label'], undefined)
})
test('brand: the artwork is a mask painted with currentColor, no second asset and no animation', () => {
  const css = read('src/brand-logo.css')
  assert.match(css, /background-color:\s*currentColor/)
  assert.match(css, /mask-image:\s*var\(--cp-brand-mark\)/)
  assert.match(css, /-webkit-mask-image:\s*var\(--cp-brand-mark\)/)
  assert.match(css, /mask-size:\s*100% 100%/)
  assert.match(css, /mask-repeat:\s*no-repeat/)
  assert.ok(!/@keyframes|animation|stroke-dashoffset/.test(css))
  // The mask must never fall back to a colour of its own: the theme owns the ink.
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css))
})
test('brand: registration belongs to the injected slot lifetime, no standalone effects', () => {
  const { logo } = fixture()
  let active = 0, release
  logo.mount({ inject(deps, callback) {
    assert.deepEqual(Array.from(deps), ['slots'])
    callback({ slots: {
      inject(name, setup) { assert.equal(name, 'sidebar.brand.mark'); release = setup() },
      register(options, component) {
        assert.equal(options.name, 'sidebar.brand.mark')
        assert.equal(options.priority, -1)
        assert.equal(component, logo.component)
        active++
        return () => { active-- }
      },
    } })
  } })
  assert.equal(active, 1)
  release()
  assert.equal(active, 0)
})
