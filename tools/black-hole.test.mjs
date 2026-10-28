import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
const source = readFileSync(new URL('../src/runtime/black-hole.js', import.meta.url), 'utf8')
function fixture() {
  let id=0
  const timers=new Map(), frames=new Map(), listeners=new Map(), painted=[], observers=[], arcs=[], fills=[], clears=[]
  const motion={matches:false,addEventListener:(k,fn)=>listeners.set('motion',fn),removeEventListener:()=>listeners.delete('motion')}
  const document={hidden:false,documentElement:{},addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)}
  class Observer { constructor(fn){this.fn=fn;this.active=true;observers.push(this)} observe(){} disconnect(){this.active=false} }
  const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,
    window:{devicePixelRatio:2,matchMedia:()=>motion},document,ResizeObserver:Observer,IntersectionObserver:Observer,MutationObserver:Observer,
    getComputedStyle:()=>({colorScheme:'dark'}),setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:n=>timers.delete(n),
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id},cancelAnimationFrame:n=>frames.delete(n)})
  vm.runInContext(source,context)
  const ctx={setTransform(){},clearRect(){clears.push(1)},fillRect(){},fillText(glyph){painted.push(glyph)},beginPath(){},arc(x,y,r){arcs.push({x,y,r})},fill(){fills.push(1)}}
  const canvas={dataset:{},width:0,height:0,getContext:()=>ctx,getBoundingClientRect:()=>({width:320,height:200})}
  function drain(){let count=0;while(timers.size){assert.ok(count++<1000);const tasks=[...timers.values()];timers.clear();tasks.forEach(fn=>fn())}}
  function frame(t){const tasks=[...frames.values()];frames.clear();tasks.forEach(fn=>fn(t))}
  return {api:context.UniverseBlackHole,canvas,timers,frames,listeners,observers,painted,arcs,fills,clears,motion,document,drain,frame}
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
  assert.equal(f.arcs.length,0);assert.equal(f.fills.length,0);assert.ok(f.clears.length>0,"the canvas must clear itself to stay transparent")
  r.setMode('light')
  assert.equal(f.arcs.length,1);assert.equal(f.fills.length,1)
  const [disc]=f.arcs
  assert.equal(disc.x,160);assert.equal(disc.y,100)
  assert.ok(Math.abs(disc.r-34)<1e-6,`horizon radius ${disc.r} should be SHADOW_SHARE*min(w,h)/2`)
  r.setMode('dark')
  assert.equal(f.arcs.length,1);assert.equal(f.fills.length,1)
  r.dispose()
})

test('mount sizes the canvas to the whole viewport and follows window resizes',()=>{
  /* 2026-10-29（用户 m00706「现在这样，但现在这个大小我更想它全区域显示了」）：画布回到
     fixed;inset:0，尺寸只认 window.innerWidth/innerHeight；窗口变化由 resize 监听驱动。 */
  const attrs={},listeners={}
  const style={}
  const canvas={dataset:{},style,setAttribute(){},remove(){this.removed=true},
    getBoundingClientRect:()=>({width:Number.parseFloat(style.width)||0,height:Number.parseFloat(style.height)||0}),
    getContext:()=>({setTransform(){},fillRect(){},fillText(){},beginPath(){},arc(){},fill(){}})}
  const win={devicePixelRatio:1,innerWidth:1240,innerHeight:900,
    addEventListener:(k,f)=>{listeners[k]=f},removeEventListener:k=>{delete listeners[k]},
    matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})}
  const doc={hidden:false,documentElement:{},
    body:{prepend(){},setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]}},
    createElement:()=>canvas,addEventListener(){},removeEventListener(){}}
  const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,document:doc,
    window:win,
    ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},
    IntersectionObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
    getComputedStyle:()=>({colorScheme:'dark'}),setTimeout:()=>0,clearTimeout(){},
    requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
  vm.runInContext(source,context)
  const dispose=context.UniverseBlackHole.mount()
  assert.equal(typeof dispose,'function')
  assert.equal(canvas.style.cssText,'position:fixed;inset:0;z-index:-1;pointer-events:none;')
  assert.equal(style.width,'1240px')
  assert.equal(style.height,'900px')
  assert.equal(typeof listeners.resize,'function','mount should follow window resizes')
  win.innerWidth=820
  win.innerHeight=640
  listeners.resize()
  assert.equal(style.width,'820px')
  assert.equal(style.height,'640px')
  assert.equal(attrs['data-uni-black-hole'],'')
  dispose()
  assert.equal(listeners.resize,undefined,'disposal must drop the resize listener')
  assert.equal(canvas.removed,true)
  assert.equal(attrs['data-uni-black-hole'],undefined)
})

test('mount ignores any container rect: a sidebar column cannot shrink the canvas',()=>{
  /* 取景不再量容器。这里故意给出一个 280..1256 的列和一个同尺寸的 frame：画布仍应是
     整个视口，左栏（0..280）也在画布之内。 */
  const attrs={},style={}
  const rect={left:280,top:0,width:976,height:821}
  const node={getBoundingClientRect:()=>rect}
  const canvas={dataset:{},style,setAttribute(){},remove(){},
    getBoundingClientRect:()=>({width:Number.parseFloat(style.width)||0,height:Number.parseFloat(style.height)||0}),
    getContext:()=>({setTransform(){},fillRect(){},fillText(){},beginPath(){},arc(){},fill(){}})}
  const doc={hidden:false,documentElement:{},
    body:{prepend(){},setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]}},
    createElement:()=>canvas,addEventListener(){},removeEventListener(){},
    querySelector:()=>node}
  const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,document:doc,
    window:{devicePixelRatio:1,innerWidth:1256,innerHeight:821,
      addEventListener(){},removeEventListener(){},
      matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},
    ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},
    IntersectionObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
    getComputedStyle:()=>({colorScheme:'dark'}),setTimeout:()=>0,clearTimeout(){},
    requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
  vm.runInContext(source,context)
  const dispose=context.UniverseBlackHole.mount()
  assert.equal(style.width,'1256px')
  assert.equal(style.height,'821px')
  assert.equal(style.left,undefined,'mount must not position the canvas from a rect')
  dispose()
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
      window:{devicePixelRatio:1,innerWidth:1256,innerHeight:900,addEventListener(){},removeEventListener(){},
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
