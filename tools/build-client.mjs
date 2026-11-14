/**
 * Build `client.js` — the browser half of dsh-quasar-theme.
 *
 * Five inputs, one output, no interpretation in between:
 *
 *   src/tokens.json         the token layer's source of truth, both modes per token
 *   src/theme.css           the paint layer (wallpaper stack, shell rescue)
 *   build/wallpapers.json   the art, already encoded as data URLs
 *
 * And a third on 2026-10-07 — the glue that mounts all of it. It used to be written
 * inline in the template below, which is how a `.hIlkoa_*`-shaped review of a string
 * became the only way to read the half that actually mounts the theme:
 *
 *   src/client.js           apply(), the mount order and the exports map, verbatim
 *                           (same rule as the mask's behaviour: the file IS the code,
 *                           so it is neither re-indented nor re-quoted on the way in)
 *
 * The generated bundle is a single `window.__ModuleLoader__.load({...})` call,
 * which is the shape the client module loader expects a plugin's browser half to
 * have. Since 2026-10-09 (D79) it is NOT committed any more: `client.js` is ignored
 * by git and built right after a checkout, because two of its data URLs would be a
 * third party's picture and the remote must not carry them. What a fresh checkout
 * builds points at that picture instead (D81): the tracked manifest names its
 * address, and the bytes stay with whoever hosts them. A machine that keeps the
 * local art in `out/wallpapers.local.json` (also ignored) embeds its own copy with
 * no flag, and `--public` forces the tracked form on such a machine too.
 *
 * Why the art goes into variables rather than into the stylesheet
 * --------------------------------------------------------------
 * The two data URLs are ~700 KB together. Inlined into `src/theme.css` they would
 * make the paint layer unreadable and unreviewable; as custom properties the sheet
 * stays a document, and the images can be swapped without touching it. The build
 * still owns the pairing — which image each mode starts on — so there is exactly one
 * place where that pairing is written down: the wallpaper manifest, read by this
 * build. No image id is quoted in prose here, so swapping a wallpaper cannot leave a
 * stale name behind in a comment.
 *
 * Which manifest that is (2026-10-09, D79; revised the same day, D81)
 * ------------------------------------------------------------------
 * The art would otherwise ride in a tracked file, which is how it got onto the
 * remote the first time. So the manifest is split in two:
 *
 *   build/wallpapers.json      TRACKED. Two entries, each with a `direct:` URL that
 *                              names a third party's copy of the picture. The build
 *                              emits `url("https://…")`, so the theme keeps its
 *                              background while the repository holds no image bytes.
 *                              `--public` forces this file.
 *   out/wallpapers.local.json  LOCAL, ignored by git. The same shape, with the two
 *                              pairs the author keeps on this machine, each carrying
 *                              a `dataUrl:`. If it exists it wins, so the daily
 *                              driver keeps embedding its own art while nothing that
 *                              could be pushed ever carries it.
 *
 * An entry with both keys prefers `dataUrl`, so a machine that holds the file keeps
 * building exactly the bundle it built before.
 *
 * Two consequences worth stating out loud: a fresh clone builds a theme whose
 * background the browser fetches from the host named in the manifest (the plugin
 * itself still opens no socket), and redistributed bytes cannot come back by
 * accident — `client.js` is ignored, and the tracked manifest holds no `dataUrl:`,
 * which `npm run selfcheck` asserts.
 *
 * Usage:
 *   node tools/build-client.mjs            # write client.js (local art if it is there)
 *   node tools/build-client.mjs --public   # write client.js from the tracked manifest
 *   node tools/build-client.mjs --check    # fail if client.js is stale
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLIENT_FILES, BRAND_LOGO_CSS_FILE, LOCAL_WALLPAPERS, resolveBuild } from './build-contract.mjs'
import { stripBlockComments, normaliseJs, compressJs, minifyCss } from './source-transforms.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = 'dsh-quasar-theme'

const read = (relative) => readFileSync(join(ROOT, relative), 'utf8')

/* The manifest this build reads: the local pair when it is there (daily driver),
 * otherwise the tracked one (a fresh checkout, and always under `--public`). The
 * rule is stated in the header; tools/selfcheck.mjs resolves it the same way so the
 * gates describe the bundle this machine actually runs. */
const build = resolveBuild(ROOT, process.argv.slice(2))
const wallpaperFile = build.wallpaperManifest

/* ------------------------------------------------------------------ inputs */

const tokensDoc = JSON.parse(read('src/tokens.json'))
const wallpapers = JSON.parse(read(wallpaperFile))
const css = read('src/theme.css')

/* P5 (2026-10-09): the paint layer ships with its comments stripped. They are most of
 * the sheet — 87,429 characters of which roughly 11,700 are live code — and every byte
 * of a `<style>` tag is parsed and then held in the CSSOM for the life of the page.
 * `src/theme.css` itself keeps every comment: they are the reasons for the rules, and
 * they are what a reviewer reads. The strip is the same naive block-comment pattern
 * tools/selfcheck.mjs already uses (css.7, cli.13); it runs on the paint layer only and
 * never on `declarations` — the art is a data URL, not CSS text. */
const cssPaint = css.replace(/\/\*[\s\S]*?\*\//g, '')

/* P5b (2026-10-15, performance round 5): the strip above covered the paint layer only,
 * and P5's own reasoning applies unchanged to the other three inputs that ride in the
 * SAME `<style>` tag — the boot sheet, the picker sheet, and the two behaviour files
 * interpolated next to them. Measured on this tree, the comments that still shipped
 * verbatim were 10,478 characters of CSS (1,396 boot + 9,082 picker) and 21,236
 * characters of JS (3,731 boot + 17,505 picker) — 31,714 characters, about 3.2% of the
 * non-wallpaper part of the bundle, parsed on every load for no runtime effect.
 *
 * Why the JS half is stripped too: these files are interpolated with the template hole
 * into a module factory, so their comments are compiled and discarded on every load.
 * src/client.js was left out here in round 5 because cli.21 asserted the shipped bundle
 * still contains its header comment; round 6 made that gate change and now strips it too
 * (see P5d below, and docs/perf-report-4-2026-10-16.md).
 *
 * Safety of the strip (both halves), checked before this was written and re-checked
 * by `node tools/selfcheck.mjs`:
 *   · CSS: the two sheets carry no url() and no data URL at all, so the pattern cannot
 *     land inside a payload; every quoted string in them is free of a comment
 *     delimiter; braces balance identically before and after (80/80 -> 70/70 for the
 *     boot+picker pair), and the strip is idempotent.
 *   · JS: neither file contains a backtick or a backslash-newline, so no string,
 *     template or regex literal can span a line start; a token walk found 0 comment
 *     openers inside a string or template; and 0 of the 69 comments sits where
 *     deleting it would merge two tokens.
 *
 * The replacement is newline-preserving, and that is not cosmetic. A block comment can
 * span lines; replacing it with a single space DELETES those newlines, which can pull
 * two statements onto one line. JavaScript inserts semicolons by rule, and
 * `a = b` on one line followed by `(x)` on the next parses as a CALL when the newline
 * goes away - a silent semantics change. Emitting one newline per newline the comment
 * contained keeps every line boundary exactly where it was, so the parse cannot move.
 * Measured cost of that guarantee: 908 characters across the three JS inputs (618 in
 * client.js, 215 in the picker, 75 in the boot file). The whitespace pass below then
 * re-collapses the CSS half, so the CSS sheets pay nothing for it. */
/* P5d (2026-10-15, performance round 6): `src/client.js` is stripped too. It was the
 * last input carrying its comments into the bundle, and it is the biggest single one:
 * 99 block comments, 53,697 characters of a 98,095-character file (54.7%). Round 5
 * left it out on purpose, and recorded why — cli.21 asserted that the bundle contains
 * the file's text verbatim, including the header comment `The theme's own client glue`,
 * so stripping it was a GATE change rather than a build change. This round makes that
 * gate change first (tools/selfcheck.mjs, cli.21 now compares the bundle against
 * `stripBlockComments(clientJs)` and no longer requires the header comment to survive),
 * and only then opens the strip here.
 *
 * Why the replacement is newline-preserving, stated honestly: it is INSURANCE, and on
 * today's tree no file needs it. The property that would make it necessary is a
 * multi-line comment that supplies the ONLY line break between two tokens which would
 * then join — replacing that comment with one space deletes the break, and automatic
 * semicolon insertion can read the pair as a single expression. Measured across all
 * three JS inputs by C:/Work/scratch/eva-perf4/q1q2.mjs: 0 such sites in src/client.js,
 * census (a line that does not end in a terminator followed by a line that could
 * continue the previous expression) reports 21 / 1 / 0 — but that counts ordinary
 * intentional multi-line code such as a wrapped argument list, where no comment is
 * involved and no strip can change anything. The looser number does NOT justify the
 * rule; the honest reason is that one code path with one guarantee is cheaper to trust
 * than two paths whose difference is a measurement that can rot, and the guarantee
 * costs 740 characters in total.
 *
 * Equivalence proof (C:/Work/scratch/eva-perf4/prove.mjs, run 2026-10-15): the same
 * hand-written JS scanner tokenizes the file before and after the strip and compares
 * every token's type, line number and value —
 *   src/client.js                98,095 -> 45,016 chars, 1,768 lines, 7,436 tokens, 0 differences
 *   src/model-effort-picker.js   45,755 -> 28,465 chars, 1,074 lines, 5,902 tokens, 0 differences
 * Identical line numbers matter as much as identical tokens: they are what ASI reads.
 * Full report: docs/perf-report-4-2026-10-16.md. */
// Implementation centralized in source-transforms.mjs; the independent selfcheck
// reference and token/line-equivalence gate deliberately remain separate.

/* P5e (2026-10-16, performance round 7): the JS inputs lose their layout whitespace.
 * Rounds 5 and 6 took the comments out of every JS input; this takes the indentation.
 * The two are the same argument one level down — a module factory is compiled on every
 * load, and leading indentation is bytes the parser skips and nothing ever reads. It is
 * also the largest purely-textual pool left that no contract protects: measured at
 * 25,792 characters across the five JS inputs — 22,830 of it indentation, 2,962 of it CR.
 * Count that on the text THIS transform sees, i.e. after `stripBlockComments` for the four
 * theme files and on the sliced factory body for the two vendored ones; a census taken on
 * the raw files would count the 7,409 characters round 6 had already taken out with the
 * comments — and they were the only place those bytes lived, since the two vendored bodies,
 * which round 6 does not strip, contribute 0 of that 7,409.
 *
 * What it does, in this order, and why that order:
 *   1. CRLF and lone CR become LF. `src/client.js` is checked out CRLF (git has it LF,
 *      core.autocrlf=true), so before this step the SAME COMMIT produced a bundle that
 *      differed by 1,161 characters depending on how the file landed on disk — and because
 *      the boot mark is sha256 of the output, a different boot mark too. Measured, not
 *      reasoned: building one tree with the file CRLF and then LF gave
 *      `764027 / eva-boot/e3e7863b` and `762866 / eva-boot/8072405e`. That is a
 *      reproducibility defect, not just a size one; normalising here makes the two
 *      checkouts agree. Those absolute numbers move whenever the sources change — what does
 *      not move is that the gap is gone.
 *   2. leading horizontal whitespace is dropped from every line.
 *
 * Why this cannot change what the code DOES: it removes no newline, so every line boundary
 * and every line number stays exactly where it was — which is what automatic semicolon
 * insertion reads. And it removes no character from inside any string, template or regex:
 * measured across all five inputs, 0 lines that begin with indentation begin inside a
 * literal. Proven per input by comparing the token streams of the before and after text
 * (type, line number and value for every token) and by `node --check`; both are restated
 * by `node tools/selfcheck.mjs` (cli.21, cli.21b).
 *
 * Two entry points, and the difference is deliberate. `normaliseJs` is the whitespace
 * half alone; `compressJs` is the comments plus it. The theme's own four files take
 * `compressJs`. The two VENDORED factory bodies take `normaliseJs` ONLY: dropping
 * indentation deletes no text a reviewer reads, while deleting a comment from
 * third-party source kept recognisable on purpose (D29) does. Their comment mass is
 * therefore still shipped, and that is a choice, not an oversight. The hand-written
 * wrapper written around each body takes neither transform — it carries the `移植自`
 * provenance markers cli.19/cli.23 pin.
 *
 * Measured: 25,792 characters removed across the five JS inputs (22,830 of it indentation,
 * 2,962 of it the CR). The bundle's own delta is 306 smaller than that, because round 7 also
 * ADDED those 306 characters of explanation to the two vendored wrapper comments, and the
 * wrappers are template text, so they ship: 25,792 − 306 = 25,486, which is the measured
 * bundle delta (764,027 -> 738,541). Full report: docs/perf-report-5-2026-10-16.md. */
// normaliseJs / compressJs are imported; historical rationale remains above.
// 2026-10-31: the second vendored body (session-eva-status) was removed at the user's
// request, so "two" above now reads as one. normaliseJs has no caller left here; the
// import stays so the wrapper contract above still describes a real transform.

/* P5c (2026-10-15, performance round 5): whitespace minimisation, applied to the three
 * sheets only — never to a JS input, where a newline is sometimes significant (ASI) and
 * a `//` comment runs to end of line.
 *
 * What it does, outside quoted strings and nothing else:
 *   1. a run of whitespace becomes one space   (\s+ -> ' ')
 *   2. the spaces adjacent to `{`, `}` and `;` are dropped
 * In CSS, whitespace outside a string carries no meaning beyond separating tokens.
 * Collapsing a run to one space therefore cannot change the parse, and `{`/`}`/`;` are
 * tokens in their own right, so a space beside them separates nothing.
 *
 * What it deliberately does NOT touch, and why: the spacing around `:` `>` `+` `~` `(`
 * `)`. src/theme.css holds six `> :first-child` / `> :nth-child(2)` selectors — there the
 * space BEFORE the colon is the descendant combinator, and deleting it would turn a
 * two-level selector into a pseudo-class. The same sheet has 52 `] >` sequences and
 * seven `calc()` expressions whose `+` needs its spaces to stay valid. A pass that
 * `\s*([{};:,>])\s*` -> `$1`-style hugs every punctuation mark corrupts all of them; this
 * pass is small precisely so it can be proven.
 *
 * Why it is safe on these files specifically (each checked, not assumed):
 *   · No quoted string in the three sheets contains a whitespace run, so rule 1 never has
 *     to decide about string interiors — and it skips them anyway (the split below).
 *   · Strings are byte-preserved: the split/join never edits a token whose first
 *     character is a quote. Four `content` values and the font names depend on this.
 *   · Idempotent, and brace/quote counts are unchanged (70/70, 19/19, 68/68).
 *   · Every `content` value and both font names survive with their spaces and their
 *     non-ASCII -- `'EVA-INSPIRED THEME / 闸门开启'` is the one that proves it.
 *
 * Measured: 26,354 -> 23,219 chars across the three sheets (-11.9%). The theme sheet is
 * the bulk of it; the two small sheets account for 1,542 of the 3,135. */
// minifyCss is imported from source-transforms.mjs.

/* The client half is a SET of files since 2026-10-27: the black-hole brand mark is the
 * component that boxes the raster artwork, concatenated in CLIENT_FILES order so every
 * part lands in one factory scope. Same verbatim rule for each of them. */
const clientJs = CLIENT_FILES.map(file => read(file).replace(/[\r\n]+$/, '')).join('\n')
const clientVerbanned = /[`]|\$\{/.exec(clientJs)
if (clientVerbanned !== null) {
  throw new Error(
    'src/client.js must stay free of backticks and template placeholders; found '
    + JSON.stringify(clientVerbanned[0]) + ' at offset ' + clientVerbanned.index)
}

const TOKENS = tokensDoc.tokens
if (TOKENS === undefined || typeof TOKENS !== 'object') {
  throw new Error('src/tokens.json has no `tokens` object')
}

/* Each mode needs exactly one default. Zero entries is still a legal state — it puts
 * `--cp-pick-*` at `none`, the paint layer's documented no-art form — but since D81
 * the tracked manifest is no longer that state: it names two `direct:` URLs, one per
 * mode. One default per mode is required as soon as one entry exists, so the shipped
 * look cannot depend on array order. */
const defaults = {}
for (const paper of wallpapers) {
  if (paper.role !== 'default') continue
  if (defaults[paper.mode] !== undefined) {
    throw new Error(`two default wallpapers for mode "${paper.mode}"`)
  }
  defaults[paper.mode] = paper
}
if (wallpapers.length > 0) {
  for (const mode of ['light', 'dark']) {
    if (defaults[mode] === undefined) throw new Error(`no default wallpaper for mode "${mode}"`)
  }
}

/* ------------------------------------------------------- wallpaper block */

const variableFor = (paper) => `--cp-wall-${paper.id}`

/* The WHALE-01 SYSTEM brand mark (2026-10-27, second revision): 「把这张图片设置为左栏
 * 顶部的品牌 Logo」. The user's ink-brush black hole replaces the vector mark in the
 * `sidebar.brand.mark` slot. It rides in the same `:root` block as the wallpapers as a
 * data URL, so the theme remains one self-contained bundle with no second file to fetch
 * and no runtime path to resolve.
 *
 * The embedded file is build/brand-mark-black-hole.png: the supplied 1254×1254 artwork,
 * cropped to its ink bounding box, scaled to 256×256 (28 CSS px at 3× is 84 px, so this
 * is headroom, not a guess) and written as RGBA with the luminance in the ALPHA channel
 * and the background dropped. Why alpha rather than the opaque original: the sheet uses
 * the PNG as a MASK and paints it with `currentColor` (src/brand-logo.css), so the same
 * bytes read white on the dark sidebar and black on the light one — the supplied black
 * square would otherwise be a black tile in the light theme, and a white ring cannot be
 * drawn on a white surface. The strokes themselves are untouched: no recolour, no
 * thickening, no filter. */
const brandMark = readFileSync(join(ROOT, 'build', 'brand-mark-black-hole.png')).toString('base64')

/* `none` is not a fallback invented here: it is the no-wallpaper state src/theme.css
 * documents, and it is what a build with an empty manifest publishes for BOTH modes
 * so `--cp-wall` still resolves — to nothing — instead of to an undefined variable. */
const pick = (mode) => defaults[mode] === undefined
  ? 'none'
  : `var(${variableFor(defaults[mode])})`

/* Which URL a wallpaper variable gets (D81, 2026-10-09). Two shapes are legal:
 * a `dataUrl:` entry — art this machine holds, embedded as before — and a
 * `direct:` entry, which is how the tracked manifest points at a third party's
 * picture without carrying its bytes. An entry with both prefers the embedded
 * art, so a machine that has the file builds the same bundle it always did. */
const artFor = (paper) => {
  const src = paper.dataUrl || paper.direct
  if (typeof src !== 'string' || src === '') {
    throw new Error(`wallpaper "${paper.id}" has neither a dataUrl nor a direct URL`)
  }
  return src
}

/* ------------------------------------------------------------ embedded fonts
 * 2026-11-02 (round 77): the brand row gets its own two faces. 「QUASAR：Cinzel +
 * CORE：EB Garamond」 names both the pairing and the two weights. The previous
 * commit removed every font asset on 2026-10-31 (D104), so this is a fresh
 * introduction rather than a revival: build/fonts.json is the new provenance file,
 * shaped like build/wallpapers.json, and no face is fetched at build time.
 *
 * Why embed instead of naming them: the stack it replaces listed DIN Alternate
 * (macOS only) and Eurostile Extended (commercial), so the old cross-platform
 * promise only ever held on the build machine. A face that exists on one OS is not
 * a design, it is a coincidence.
 *
 * @font-face cannot live in src/theme.css: selfcheck css.7 gates that sheet to
 * element contracts and rejects at-blocks. It rides in `declarations` instead,
 * which src/client.js:417 writes at the head of the same <style> tag -- one
 * removable layer -- and shortenDataUrls turns each data URL into a blob URL at
 * runtime, exactly as it already does for the wallpapers and the mark.
 *
 * The byte count is checked, not trusted: a swapped file with the same name would
 * otherwise ship silently and surface only as a fallback face. */
const FONTS_FILE = join(ROOT, 'build', 'fonts.json')
const fonts = JSON.parse(readFileSync(FONTS_FILE, 'utf8'))
const fontFaces = fonts.map((font) => {
  const bytes = readFileSync(join(ROOT, font.file))
  if (bytes.length !== font.bytes) {
    throw new Error(`font "${font.id}" is ${bytes.length} bytes, ` +
      `${FONTS_FILE} records ${font.bytes}`)
  }
  return `@font-face {font-family:'${font.family}';font-style:${font.style};` +
    `font-weight:${font.weight};font-display:swap;` +
    `src:url("data:font/woff2;base64,${bytes.toString('base64')}") format("woff2");}`
})

const declarations = [
  ...fontFaces,
  ':root {',
  ...wallpapers.map((paper) => `  ${variableFor(paper)}: url("${artFor(paper)}");`),
  `  --cp-pick-light: ${pick('light')};`,
  `  --cp-pick-dark: ${pick('dark')};`,
  `  --cp-brand-mark: url("data:image/png;base64,${brandMark}");`,
  '}',
].join('\n')

/* ------------------------------------------------ brand-mark stylesheet (2026-10-27)
 * The mark is the user's ink-brush artwork. The component (src/runtime/brand-logo.js) only
 * sets the box; the sheet turns `--cp-brand-mark` into a mask and the row's own foreground
 * colour into the ink, which is the whole reason one PNG serves both modes. There is no
 * animation left in it: the supplied image is a still drawing, and a fake drift would be a
 * second design decision nobody asked for.
 *
 * Why it rides next to the paint layer rather than inside it: the paint layer's selectors are
 * gated (selfcheck css.7 accepts only body/:root/#root and [data-*] contracts), and these are
 * the component's own class names — theme-internal contract, not the app's surface. Appending
 * it to the SAME <style> tag is what keeps the one-removable-layer promise: turn the plugin off
 * and the mark's rules go with the sheet, no separate teardown.
 *
 * Comments are stripped here, exactly like the boot and picker sheets: this is shipped CSS. */
const brandLogoCss = read(BRAND_LOGO_CSS_FILE).replace(/\/\*[\s\S]*?\*\//g, '')
const BRAND_LOGO_CSS = minifyCss(brandLogoCss)


/* ---------------------------------------------------------------- manifest */

const MANIFEST = {
  id: PLUGIN_ID,
  build,
  name: 'dsh-quasar-theme / 类星体',
  modes: { light: 'Daylight City', dark: 'Neon Night' },
  tokens: Object.keys(TOKENS).length,
  fonts: fonts.map((font) => ({
    id: font.id,
    family: font.family,
    weight: font.weight,
    bytes: font.bytes,
    license: font.license,
    licenseFile: font.licenseFile,
  })),
  wallpapers: wallpapers.map((paper) => ({
    id: paper.id,
    name: paper.name,
    mode: paper.mode,
    role: paper.role,
    page: paper.page,
    direct: paper.direct,
    credit: paper.credit,
    shippedResolution: paper.shippedResolution,
    sourceResolution: paper.sourceResolution,
    meanLuminance: paper.meanLuminance,
  })),
  veil: tokensDoc.meta.veilAlpha,
  byLayer: tokensDoc.meta.byLayer,
}


/* ------------------------------------------------------------- generation */

/* The banner names the manifest it actually read, and says which of the two states
 * this bundle is in. Both facts are otherwise invisible in a 1.1 MB file: a bundle
 * that embeds art, a bundle that points at art and a bundle with no art at all look
 * alike until you search for `data:image/webp` or for `https://`. */
const wallpaperNote = wallpapers.length === 0
  ? '\n *                          (no wallpaper in this build: the manifest is empty)'
  : (wallpaperFile === LOCAL_WALLPAPERS
    ? '\n *                          (from out/wallpapers.local.json — LOCAL, not in git, art embedded)'
    : '\n *                          (from the tracked manifest — art by URL, no image bytes)')

const banner = `/**
 * dsh-quasar-theme — browser client bundle. GENERATED FILE, DO NOT EDIT.
 *
 * Generated by tools/build-client.mjs from:
 *   src/tokens.json        ${MANIFEST.tokens} tokens, every one with a light and a dark value
 *   src/theme.css          the paint layer
 *   ${wallpaperFile}  ${MANIFEST.wallpapers.length} wallpapers (embedded art or URL)${wallpaperNote}
 *
 * Eight blocks, ten effects — every one of them the theme's own since the vendored
 * session-status rail left on 2026-10-31 — all mounted through \`ctx.effect\` so
 * unloading the plugin retracts everything it added:
 *
 *   1. theme.overrideTokens — the token layer. The service composes this over the
 *      active theme and writes it as inline custom properties on \`body\`, so it wins
 *      over the shipped declarations without a stylesheet of ours and without
 *      copying any value that was not deliberately changed. Two of the tokens ship
 *      as the wallpaper VEIL (their alpha is the number the contrast budget solved
 *      for), which is why they are also read by the paint layer.
 *
 *   2. an svg of filters — the liquid glass. The refraction map behind each glass
 *      surface is drawn here at the element's own pixel size (a map is not an input
 *      file; it is computed from the box), and the paint layer only names it by id.
 *      The split is forced: feImage stretches what it is given, so a fixed map would
 *      scale its own bevel with the element.
 *
 *   3. a plugin-owned <style> — the paint layer. A custom property can carry a
 *      colour but not a stack of composited background layers, so the art and its
 *      veil live in a stylesheet. It writes no colour of its own.
 *      Since
 *      2026-10-31 it also owns the hover-collapse trigger: the sheet matches only
 *      [data-uni-grav], and the attribute is written from the element's UNSCALED box,
 *      because a box that shrinks itself loses its own hit area and its edge then
 *      oscillates between 0.97 and 1.00 forever (gravity.js is the accounting).
 *
 *   5. the sidebar brand row's three zones (since round 25) — that row is ONE
 *      official button whose click starts a session, and two of the three labels
 *      drawn on it open surfaces this theme hides, so a capture-phase click
 *      listener reroutes by coordinate. It is the one effect that has to be a
 *      listener instead of a style: React delegates at #root, which sits BELOW
 *      document, so nothing registered later can win the event first.
 *
 *   6. the workspace list's pin control (round 39) — one button per workspace row,
 *      injected into that row's own action span, plus the durable reordering it drives.
 *      The set of pinned workspaces is the one thing this theme keeps in browser
 *      storage: the host half has no node_modules of its own, the remote protocol it
 *      would need has no cordis anywhere on this disk, and its two standing rules (no
 *      filesystem writes, no routes) together with "exports no Config" close every
 *      other door. The ORDER is already durable on the host, so each reorder goes
 *      through the official insertBefore and survives a restart.
 *
 *   7. the WeChat workspace switch (rounds 42-44) — one row holds one view: a click leaves
 *      only the workspace the WeChat plugin creates, another click puts the official list
 *      back (the exclusive switch the user chose over a stacking one). Its MutationObserver
 *      reads batches, not the whole document: records outside its own row are dropped
 *      before any query runs.
 *
 *   8. the selection optics (2026-10-31) — the Doppler fringe on the selected session
 *      row is pure CSS, so this effect owns only the half the sheet cannot do. It
 *      injects one fixed-geometry displacement map as an SVG filter (#uni-sel-lens)
 *      and bends the text node each selected surface actually draws through, so no
 *      icon or chevron is dragged along; a surface with no findable text node is
 *      skipped whole, because no distortion beats a distorted row. The entry peak is
 *      one WAAPI keyframe, played only when the user changed the selection, driving
 *      the registered --uni-sel-k back to the stable value the sheet declares.
 *
 * Nine is pinned by tools/selfcheck.mjs (cli.11d), so another effect cannot slip in
 * unnoticed.
 *
 * The effect disposers are the whole uninstall story: the theme is one removable
 * layer, and turning it off returns the app to the shipped theme with no residue.
 * A theme that leaks a token keeps affecting the UI after it is disabled, and the
 * leak is invisible — which is why nothing here is applied outside \`ctx.effect\`.
 */`

const body = `
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PLUGIN_ID)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var PLUGIN_ID = ${JSON.stringify(PLUGIN_ID)}

    var TOKENS = ${JSON.stringify(TOKENS)}

    var MANIFEST = ${JSON.stringify(MANIFEST)}

    var WALLPAPER_DECLARATIONS = ${JSON.stringify(declarations)}

    var CSS = ${JSON.stringify(minifyCss(cssPaint))}

    var BRAND_LOGO_CSS = ${JSON.stringify(BRAND_LOGO_CSS)}
${compressJs(clientJs)}
  },
})
`

const output = `${banner}\n${body}`

/* ------------------------------------------------------------------- check */

const target = join(ROOT, 'client.js')

if (process.argv.includes('--check')) {
  if (!existsSync(target)) {
    console.error('client.js is missing — run `node tools/build-client.mjs` first')
    process.exit(1)
  }
  const onDisk = readFileSync(target, 'utf8')
  if (onDisk === output) {
    console.log(`client.js check: OK (in sync with src/, ${output.length} chars, ` +
      `${MANIFEST.tokens} tokens, ${MANIFEST.fonts.length} fonts, ` +
      `${MANIFEST.wallpapers.length} wallpapers from ${wallpaperFile})`)
    process.exit(0)
  }
  console.error('client.js is STALE — it does not match src/ + the wallpaper manifest.')
  console.error(`  on disk ${onDisk.length} chars, generated ${output.length} chars ` +
    `(${wallpaperFile}, ${MANIFEST.wallpapers.length} wallpapers)`)
  const a = onDisk.split('\n')
  const b = output.split('\n')
  let shown = 0
  for (let i = 0; i < Math.max(a.length, b.length) && shown < 8; i += 1) {
    if (a[i] !== b[i]) {
      console.error(`  line ${i + 1}:`)
      console.error(`    on disk:   ${String(a[i]).slice(0, 120)}`)
      console.error(`    generated: ${String(b[i]).slice(0, 120)}`)
      shown += 1
    }
  }
  console.error('  run: node tools/build-client.mjs   (--public to drop the local art)')
  process.exit(1)
}

writeFileSync(target, output)
/* `.length` is a CHARACTER count, not bytes: the bundle contains Chinese text, so
 * the file on disk is a little larger. Both numbers are reported honestly rather
 * than calling the character count "bytes". */
console.log(`wrote client.js  ${output.length} chars (${Buffer.byteLength(output, 'utf8')} bytes)  ` +
  `${MANIFEST.tokens} tokens  ${MANIFEST.fonts.length} fonts  ` +
  `${MANIFEST.wallpapers.length} wallpapers from ${wallpaperFile}  ` +
  `css ${css.length} chars (${cssPaint.length} after the comment strip, ` +
  `${minifyCss(cssPaint).length} after comment+whitespace)  ` +
  `wallpaper block ${declarations.length} chars`)