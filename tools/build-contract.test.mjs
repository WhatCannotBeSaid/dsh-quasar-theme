import { test } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLIENT_FILES, parseMode, resolveBuild, validateArtifact } from './build-contract.mjs'
import { EVIDENCE_INPUTS, evidenceProblems } from './audit-evidence.mjs'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('S10: concatenation order puts each shared helper ahead of its readers', () => {
  /* clientSource() joins CLIENT_FILES as one factory body, so a module can only call a
     `var` a LATER file defines if it does so from a callback that runs after the whole
     body -- which is true today only by luck. Pin the order instead: the shared
     mutation test is read at mount time by glass and lens, and both extracted mounts
     are called by src/client.js. */
  const at = file => CLIENT_FILES.indexOf(file)
  for (const file of ['src/runtime/mutation-records.js', 'src/runtime/displacement-mount.js',
    'src/runtime/glass.js', 'src/runtime/lens.js',
    'src/runtime/status-row-mount.js', 'src/runtime/accretion.js', 'src/runtime/kepler.js',
    'src/runtime/composer-typed.js', 'src/runtime/brand-routing.js', 'src/client.js']) {
    assert.ok(at(file) >= 0, file + ' is not in CLIENT_FILES')
  }
  assert.ok(at('src/runtime/mutation-records.js') < at('src/runtime/glass.js'))
  assert.ok(at('src/runtime/mutation-records.js') < at('src/runtime/lens.js'))
  /* The extracted mount reads the shared mutation test and both effects read it, so it
     must sit after mutation-records.js and before the two files that call it. */
  assert.ok(at('src/runtime/mutation-records.js') < at('src/runtime/displacement-mount.js'))
  assert.ok(at('src/runtime/displacement-mount.js') < at('src/runtime/glass.js'))
  assert.ok(at('src/runtime/displacement-mount.js') < at('src/runtime/lens.js'))
  /* The status filter is looked up by accretion and kepler at their mount time, so the
     helper file must be read before both extract their observers. */
  assert.ok(at('src/runtime/mutation-records.js') < at('src/runtime/accretion.js'))
  assert.ok(at('src/runtime/mutation-records.js') < at('src/runtime/kepler.js'))
  /* The shared row-mount skeleton both effects call reads the mutation test, so it must
     sit after mutation-records.js and before the two mounts that call it. */
  assert.ok(at('src/runtime/mutation-records.js') < at('src/runtime/status-row-mount.js'))
  assert.ok(at('src/runtime/status-row-mount.js') < at('src/runtime/accretion.js'))
  assert.ok(at('src/runtime/status-row-mount.js') < at('src/runtime/kepler.js'))
  assert.ok(at('src/runtime/composer-typed.js') < at('src/client.js'))
  assert.ok(at('src/runtime/brand-routing.js') < at('src/client.js'))
  /* One implementation position: the shipped bundle carries each of them exactly once,
     and the composer mount the client actually calls is the extracted one -- the inert
     pre-refactor copy in src/client.js is inside a block comment and never ships. */
  assert.ok(existsSync(join(root, 'client.js')), 'client.js is missing; run npm run build before this check')
  const shipped = readFileSync(join(root, 'client.js'), 'utf8')
  for (const name of ['var uniMutationTouches = function', 'var uniStatusMutationTouches = function', 'function mountComposerTyped', 'function mountBrandRowZones']) {
    assert.equal(shipped.split(name).length - 1, 1, name + ' must appear once in client.js')
  }
  const glue = readFileSync(join(root, 'src/client.js'), 'utf8')
  assert.equal(glue.includes('deferEffect(() => mountBrandRowZones(ctx)), \'universe: brand row zones\')'), true)
  assert.equal(glue.includes("deferEffect(() => mountComposerTyped()), 'universe: composer typed state'"), true)
  for (const file of ['src/runtime/glass.js', 'src/runtime/lens.js']) {
    assert.equal(readFileSync(join(root, file), 'utf8').includes('var could = function'), false, file + ' kept a second copy of the test')
  }
})

test('S10: source distribution includes build tools and all declared runtime modules', () => {
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'))
  for (const tool of ['tools/build-client.mjs','tools/build-contract.mjs','tools/source-transforms.mjs']) assert.ok(pkg.files.includes(tool), tool+' must ship for prepare')
  assert.ok(pkg.files.includes('src'))
  assert.ok(pkg.files.includes('build'))
  assert.ok(pkg.files.includes('client.js'))
  for(const file of [...CLIENT_FILES,'tools/build-client.mjs','tools/build-contract.mjs','tools/source-transforms.mjs']) assert.ok(existsSync(join(root,file)))
})

test('S1: modes are strict and legacy public is compatible', () => {
  assert.equal(parseMode([]), 'auto')
  assert.equal(parseMode(['--public']), 'public')
  assert.equal(parseMode(['--mode=local']), 'local')
  for (const args of [['--mode'], ['--mode', 'wat'], ['--mode='], ['--public', '--mode', 'local'], ['--mode=auto', '--mode=auto']]) assert.throws(() => parseMode(args))
  assert.equal(resolveBuild(root, ['--mode=public']).wallpaperManifest, 'build/wallpapers.json')
  assert.throws(() => resolveBuild(join(root, 'nonexistent-fixture'), ['--mode=local']), /missing/)
})

test('S1: artifact input and mode mismatch fail; no image-format inference', () => {
  const expected = resolveBuild(root, ['--mode=public'])
  const source = 'var MANIFEST = ' + JSON.stringify({ build: expected }) + '\n'
  assert.deepEqual(validateArtifact(source, expected), expected)
  assert.throws(() => validateArtifact(source, { ...expected, mode: 'local' }), /mismatch/)
  assert.throws(() => validateArtifact(source, { ...expected, wallpaperSha256: 'changed' }), /mismatch/)
  assert.throws(() => validateArtifact('data:image/webp;base64,old', expected), /mismatch/)
})

test('S1: release provenance rejects absent, stale, mismatched host or input', () => {
  const now = Date.parse('2026-10-20T00:00:00Z')
  const hashes = Object.fromEntries(EVIDENCE_INPUTS.map(p => [p, 'hash:' + p]))
  const record = { schema: 1, hostVersion: 'test-target', collectedAt: '2026-10-19T00:00:00Z', sha256: hashes }
  assert.deepEqual(evidenceProblems(record, hashes, 'test-target', now), [])
  assert.ok(evidenceProblems(null, hashes, 'test-target', now).length)
  assert.ok(evidenceProblems(record, hashes, null, now).length)
  assert.ok(evidenceProblems(record, hashes, 'other', now).length)
  assert.ok(evidenceProblems({...record, collectedAt:'2026-01-01'}, hashes, 'test-target', now).length)
  assert.ok(evidenceProblems(record, {...hashes, 'client.js':'changed'}, 'test-target', now).length)
})
/* D1（2026-11-01 第十一轮收尾二）：done 交回官方默认样式。
 * 用户 m01130：「删除 done 全部的代码，恢复成官方默认样式。」于是主题不再有任何
 * data-state='done' 规则，也没有 --uni-done-star 那枚非官方星色。这条断言只钉一件
 * 事：那一节不许回来 —— 星色、16px 盒、::after 的 31.25% 都是我们改过的痕迹，任何
 * 一条回来了，done 就和官方 StateDot 长得不一样了。 */
test('D1: done keeps the stock StateDot — no done rule, no star colour, no build sheet', () => {
  const css = readFileSync(join(root, 'src/theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const client = readFileSync(join(root, 'client.js'), 'utf8')
  assert.equal(css.includes("data-state='done'"), false, 'a done rule came back into the paint layer')
  assert.equal(css.includes('uni-done'), false, 'the done variable came back')
  assert.equal(client.includes('--uni-done-star'), false, 'the star colour came back')
  assert.equal(client.includes('DONE_STAR_CSS'), false, 'the build wiring came back')
  assert.equal(existsSync(join(root, 'src/done-star.css')), false, 'the star sheet came back')
  assert.equal(client.includes('mountDoneMark'), false, 'the done JS came back')
})

// Startup decoration was retired at the user's request; debug URLs cannot restore it.
test('startup animation is absent from source wiring and the shipped artifact', () => {
  const glue = readFileSync(join(root, 'src/client.js'), 'utf8')
  const build = readFileSync(join(root, 'tools/build-client.mjs'), 'utf8')
  const shipped = readFileSync(join(root, 'client.js'), 'utf8')
  for (const text of [glue, build, shipped]) {
    assert.doesNotMatch(text, /mountBootScreen|destroyBoot|BOOT_CSS|BOOT_MARK|data-uni-boot|boot-screen[.](?:js|css)|boot=1/)
  }
  assert.match(glue, /UniverseAccretionDisk[.]mount[(][)]/)
})
