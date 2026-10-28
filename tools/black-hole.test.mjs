import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
const source = readFileSync(new URL('../src/runtime/black-hole.js', import.meta.url), 'utf8')
function fixture() {
  let id=0
  const timers=new Map(), frames=new Map(), listeners=new Map(), painted=[], observers=[], arcs=[], fills=[]
  const motion={matches:false,addEventListener:(k,fn)=>listeners.set('motion',fn),removeEventListener:()=>listeners.delete('motion')}
  const document={hidden:false,documentElement:{},addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)}
  class Observer { constructor(fn){this.fn=fn;this.active=true;observers.push(this)} observe(){} disconnect(){this.active=false} }
  const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,
    window:{devicePixelRatio:2,matchMedia:()=>motion},document,ResizeObserver:Observer,IntersectionObserver:Observer,MutationObserver:Observer,
    getComputedStyle:()=>({colorScheme:'dark'}),setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:n=>timers.delete(n),
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id},cancelAnimationFrame:n=>frames.delete(n)})
  vm.runInContext(source,context)
  const ctx={setTransform(){},fillRect(){},fillText(glyph){painted.push(glyph)},beginPath(){},arc(x,y,r){arcs.push({x,y,r})},fill(){fills.push(1)}}
  const canvas={dataset:{},width:0,height:0,getContext:()=>ctx,getBoundingClientRect:()=>({width:320,height:200})}
  function drain(){let count=0;while(timers.size){assert.ok(count++<1000);const tasks=[...timers.values()];timers.clear();tasks.forEach(fn=>fn())}}
  function frame(t){const tasks=[...frames.values()];frames.clear();tasks.forEach(fn=>fn(t))}
  return {api:context.UniverseBlackHole,canvas,timers,frames,listeners,observers,painted,arcs,fills,motion,document,drain,frame}
}
test('ASCII parameters clamp angle, cell budget and speed; glyph alphabet is printable ASCII',()=>{
  const {api}=fixture()
  assert.equal(api.options().angle,15)
  assert.equal(api.options({angle:90}).angle,50)
  assert.equal(api.options({angle:0,maxCells:Infinity}).angle,10)
  assert.equal(api.options({maxCells:Infinity}).maxCells,16000)
  assert.match(api.glyphs,/^[\x20-\x7e]+$/)
})
test('null-path cache contains dark captured rays and finite emitting disk intersections across all angles',()=>{
  const {api}=fixture()
  for(const angle of [12,15,20]){
    assert.equal(api.trace(0,0,angle).captured,true)
    let emitting=0,changing=0,brightLeft=0,brightRight=0
    for(let y=-.6;y<=.6;y+=.04)for(let x=-.85;x<=.85;x+=.04){
      const ray=api.trace(x,y,angle)
      if(!ray.radius)continue
      emitting++;assert.ok(ray.radius>=6&&ray.radius<=20);assert.ok(Number.isFinite(ray.boost)&&ray.boost>0)
      const a=api.shade(ray,0,1),b=api.shade(ray,2,1)
      assert.ok(a>=0&&a<=1);if(Math.abs(a-b)>.001)changing++
      if(x<0)brightLeft+=ray.boost;else brightRight+=ray.boost
    }
    assert.ok(emitting>50);assert.ok(changing>20);assert.ok(Math.abs(brightRight-brightLeft)>10)
  }
})
test('dark paint leaves the shadow to the background; light paint fills it with ink first',()=>{
  const f=fixture(),r=f.api.create(f.canvas)
  f.drain();assert.equal(r.stats().ready,true)
  assert.equal(f.arcs.length,0);assert.equal(f.fills.length,0)
  r.setMode('light')
  assert.equal(f.arcs.length,1);assert.equal(f.fills.length,1)
  const [disc]=f.arcs
  assert.equal(disc.x,160);assert.equal(disc.y,100)
  assert.ok(Math.abs(disc.r-34)<1e-6,`horizon radius ${disc.r} should be SHADOW_SHARE*min(w,h)/2`)
  r.setMode('dark')
  assert.equal(f.arcs.length,1);assert.equal(f.fills.length,1)
  r.dispose()
})

test('mount sizes the canvas to the main+rightbar frame and leaves the sidebar outside it',()=>{
  const attrs={}
  const frame={getBoundingClientRect:()=>({left:240,top:0,width:1000,height:900})}
  const body={prepend(){},setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]}}
  /* 位置/尺寸由 `left/top/width/height` 四个独立属性给，所以这里用单独的 style 对象接住；
     画布自己的 getBoundingClientRect 跟着它走，第二轮 resize 才是真实尺寸。 */
  const style={}
  const canvas={dataset:{},style,setAttribute(){},remove(){this.removed=true},
    getBoundingClientRect:()=>({width:Number.parseFloat(style.width)||0,height:Number.parseFloat(style.height)||0}),
    getContext:()=>({setTransform(){},fillRect(){},fillText(){},beginPath(){},arc(){},fill(){}})}
  const doc={hidden:false,documentElement:{},body,createElement:()=>canvas,addEventListener(){},removeEventListener(){},
    querySelector:s=>s.includes("[data-slot='root']")?frame:null}
  const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,document:doc,
    window:{devicePixelRatio:1,innerWidth:1240,innerHeight:900,matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},
    ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},
    IntersectionObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
    getComputedStyle:()=>({colorScheme:'dark'}),setTimeout:()=>0,clearTimeout(){},
    requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
  vm.runInContext(source,context)
  const dispose=context.UniverseBlackHole.mount()
  assert.equal(typeof dispose,'function')
  assert.equal(canvas.style.left,'240px');assert.equal(canvas.style.top,'0px')
  assert.equal(canvas.style.width,'1000px');assert.equal(canvas.style.height,'900px')
  assert.equal(attrs['data-uni-black-hole'],'')
  dispose()
  assert.equal(canvas.removed,true);assert.equal(attrs['data-uni-black-hole'],undefined)
})

test('mount leaves the sidebar outside the canvas: left edge from the column, right edge from the frame',()=>{
  /* 2026-10-29（用户点名「黑洞限制在对话区和右侧栏内，左栏独立开」）：真机结构里
     column（[data-slot='root'] > * > div:has(> [data-slot='main'])）与 frame
     （[data-slot='root'] > *）不是同一个元素。左边界只认 column 左边，左栏在它左边，
     因此不进取景；右边界认 frame 右边，右栏是 column 的兄弟、和它同包在 frame 里，
     所以右栏展开时也不会把黑洞在右栏边缘切掉。 */
  function mountWith(columnRect, frameRect) {
    const attrs={},style={}
    const column={getBoundingClientRect:()=>columnRect}
    const frame={getBoundingClientRect:()=>frameRect}
    const canvas={dataset:{},width:0,height:0,style,setAttribute(){},remove(){},
      getBoundingClientRect:()=>({width:Number.parseFloat(style.width)||0,height:Number.parseFloat(style.height)||0}),
      getContext:()=>({setTransform(){},fillRect(){},fillText(){},beginPath(){},arc(){},fill(){}})}
    const doc={hidden:false,documentElement:{},
      body:{prepend(){},setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]}},
      createElement:()=>canvas,addEventListener(){},removeEventListener(){},
      querySelector:s=>s==="[data-slot='root'] > * > div:has(> [data-slot='main'])"?column
        :s==="[data-slot='root'] > *"?frame:null}
    const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,document:doc,
      window:{devicePixelRatio:1,innerWidth:frameRect.width,innerHeight:frameRect.height,
        matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},
      ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},
      IntersectionObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
      getComputedStyle:()=>({colorScheme:'dark'}),setTimeout:()=>0,clearTimeout(){},
      requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
    vm.runInContext(source,context)
    const dispose=context.UniverseBlackHole.mount()
    const box={left:style.left,top:style.top,width:style.width,height:style.height}
    dispose()
    return box
  }
  /* 真机 1256px 视口：左栏 0..280，对话区 280..1256，右栏收起。 */
  assert.deepEqual(
    mountWith({left:280,top:0,width:976,height:821},{left:0,top:0,width:1256,height:821}),
    {left:'280px',top:'0px',width:'976px',height:'821px'})
  /* 右栏展开：对话区被压到 280..880，右栏 880..1256，取景仍要盖到 frame 右边。 */
  assert.deepEqual(
    mountWith({left:280,top:0,width:600,height:821},{left:0,top:0,width:1256,height:821}),
    {left:'280px',top:'0px',width:'976px',height:'821px'})
})

test('mount publishes the canvas clear colour the sidebar is painted with',()=>{
  /* 2026-10-29：theme.css 把左栏漆成 `--cp-void`（画布清屏色），值由这里按模式发布到
     documentElement 上；缺了这一步自检照样绿，但左栏会退回官方底纱，割裂感原样回来。 */
  function mountWith(scheme) {
    const props={}
    const rootStyle={setProperty:(k,v)=>{props[k]=v},removeProperty:k=>{delete props[k]}}
    const frame={getBoundingClientRect:()=>({left:280,top:0,width:976,height:900})}
    const canvas={dataset:{},style:{},setAttribute(){},remove(){},
      getBoundingClientRect:()=>({width:976,height:900}),
      getContext:()=>({setTransform(){},fillRect(){},fillText(){},beginPath(){},arc(){},fill(){}})}
    const doc={hidden:false,documentElement:{style:rootStyle},
      body:{prepend(){},setAttribute(){},removeAttribute(){}},
      createElement:()=>canvas,addEventListener(){},removeEventListener(){},
      querySelector:s=>s.includes("[data-slot='root']")?frame:null}
    const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,document:doc,
      window:{devicePixelRatio:1,innerWidth:1256,innerHeight:900,
        matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},
      ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},
      IntersectionObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
      getComputedStyle:()=>({colorScheme:scheme}),setTimeout:()=>0,clearTimeout(){},
      requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
    vm.runInContext(source,context)
    return {props,dispose:context.UniverseBlackHole.mount()}
  }
  const dark=mountWith('dark')
  assert.equal(dark.props['--cp-void'],'#030509')
  dark.dispose()
  assert.equal(dark.props['--cp-void'],undefined)
  const light=mountWith('light')
  assert.equal(light.props['--cp-void'],'#edf0f4')
  light.dispose()
})

test('Canvas draws glyphs only; pause, reduced motion, hide, rebuild and disposal cancel owned work',()=>{
  const f=fixture(),r=f.api.create(f.canvas)
  assert.equal(r.stats().ready,false);f.drain();assert.equal(r.stats().ready,true)
  assert.ok(r.stats().cells<=16000);assert.ok(f.painted.length>0)
  assert.ok(f.painted.every(g=>g.length===1&&f.api.glyphs.includes(g)))
  f.frame(100);f.frame(140);assert.ok(r.stats().frames>=2)
  f.motion.matches=true;f.listeners.get('motion')();assert.equal(f.frames.size,0)
  f.motion.matches=false;f.listeners.get('motion')();assert.equal(f.frames.size,1)
  f.document.hidden=true;f.listeners.get('visibilitychange')();assert.equal(f.frames.size,0)
  f.document.hidden=false;f.listeners.get('visibilitychange')();assert.equal(f.frames.size,1)
  r.update({speed:0});assert.equal(f.frames.size,0)
  r.update({angle:25});assert.ok(f.timers.size>0)
  r.dispose();r.dispose();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0)
  assert.ok(f.observers.every(o=>!o.active));assert.equal(f.canvas.dataset.blackHoleState,'disposed')
})
