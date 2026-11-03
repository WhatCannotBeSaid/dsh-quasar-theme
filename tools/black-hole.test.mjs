import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
const source = readFileSync(new URL('../src/runtime/black-hole.js', import.meta.url), 'utf8')
function fixture(patched, size, opts) {
  let id=0
  const box=size||{width:320,height:200}
  const timers=new Map(), frames=new Map(), listeners=new Map(), painted=[], placed=[], observers=[], arcs=[], fills=[], inks=[]
  const bakes=[]
  const motion={matches:false,addEventListener:(k,fn)=>listeners.set('motion',fn),removeEventListener:()=>listeners.delete('motion')}
  const document={hidden:false,documentElement:{},addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)}
  /* 环层需要 document.createElement + createImageData：只有显式 opts.canvas2d 时才提供，
     这样既有用例仍然走「没有 offscreen canvas → 纯 ASCII」的那条路，行为一点不变。
     putImageData 记下每一张真正被提交的遮罩，测试据此数 alpha 像素。 */
  if(opts&&opts.canvas2d){
    document.createElement=()=>{
      const off={width:0,height:0}
      const octx={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),
        putImageData:img=>{(off.images||(off.images=[])).push(img);bakes.push(img)},
        drawImage(){},fillRect(){},setTransform(){},save(){},restore(){},clearRect(){},fillStyle:'',globalCompositeOperation:''}
      off.getContext=()=>octx
      return off
    }
  }
  class Observer { constructor(fn){this.fn=fn;this.active=true;observers.push(this)} observe(){} disconnect(){this.active=false} }
  const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,Uint8ClampedArray,
    window:{devicePixelRatio:2,matchMedia:()=>motion,addEventListener:(k,fn)=>listeners.set('window:'+k,fn),removeEventListener:k=>listeners.delete('window:'+k)},document,ResizeObserver:Observer,IntersectionObserver:Observer,MutationObserver:Observer,
    getComputedStyle:()=>({colorScheme:'dark'}),setTimeout:fn=>{timers.set(++id,fn);return id},clearTimeout:n=>timers.delete(n),
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id},cancelAnimationFrame:n=>frames.delete(n)})
  Object.assign(context,opts&&opts.globals) /* 仅测试替换：覆盖 VM 里的 Math 等 */
  vm.runInContext(patched||source,context)
  /* inks 记的是每枚圆 fill() 时用的 fillStyle：两档差异只允许出现在墨色上，
     所以测试要能把墨色和几何分开断言。 */
  const ctx={setTransform(){},save(){},restore(){},fillRect(){},clearRect(){},fillText(glyph,x,y){painted.push(glyph);placed.push({glyph,x,y})},drawImage(){},beginPath(){},arc(x,y,r){arcs.push({x,y,r})},fill(){fills.push(1);if(ctx.fillStyle!==undefined)inks.push(String(ctx.fillStyle))},fillStyle:''}
  const canvas={dataset:{},width:0,height:0,getContext:()=>ctx,getBoundingClientRect:()=>({width:box.width,height:box.height})}
  function drain(){let count=0;while(timers.size){assert.ok(count++<1000);const tasks=[...timers.values()];timers.clear();tasks.forEach(fn=>fn())}}
  function frame(t){const tasks=[...frames.values()];frames.clear();tasks.forEach(fn=>fn(t))}
  return {api:context.UniverseBlackHole,canvas,context,timers,frames,listeners,observers,painted,placed,arcs,fills,inks,bakes,motion,document,drain,frame,box}
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
      emitting++;assert.ok(ray.radius>=6&&ray.radius<=20);assert.ok(Number.isFinite(ray.g4)&&ray.g4>0)
      const a=api.shade(ray,0,1),b=api.shade(ray,2,1)
      assert.ok(a>=0&&a<=1);if(Math.abs(a-b)>.001)changing++
      if(x<0)brightLeft+=ray.g4;else brightRight+=ray.g4
    }
    assert.ok(emitting>50);assert.ok(changing>20);assert.ok(Math.abs(brightRight-brightLeft)>10)
  }
})
test('both themes fill the shadow disc first: same centre and radius, only the ink differs',()=>{
  const f=fixture(),r=f.api.create(f.canvas)
  f.drain();assert.equal(r.stats().ready,true)
  /* 暗档也必须铺这枚圆：被捕获的格子没有 glyph，draw() 的循环会跳过它们，画布又每帧
     clearRect 成全透明 —— 不铺就把整个洞心让给页面底纹，洞变成一张静止的纹理。
     旧的断言正好相反（暗档 arcs 必须为 0），那是在把缺陷写成契约。 */
  assert.equal(f.arcs.length,1,`dark paint must fill the shadow disc, got ${f.arcs.length} arcs`)
  assert.equal(f.fills.length,1)
  const [dark]=f.arcs
  assert.equal(dark.x,160);assert.equal(dark.y,100)
  /* 阴影半径是有限距离临界投影 rho_c=0.34123924246684356 的一半短边，不是 SHADOW_SHARE 的取整：
     320x200 短边 200 → 34.12392424668435。旧值 34 是小角近似，偏小 0.3645%。 */
  assert.ok(Math.abs(dark.r-34.12392424668435)<1e-9,`horizon radius ${dark.r} should be rho_c*min(w,h)/2`)
  const darkInk=f.inks[0]
  r.setMode('light')
  assert.equal(f.arcs.length,2,`light paint must also fill a shadow disc, got ${f.arcs.length} arcs`)
  assert.equal(f.fills.length,2)
  const [,light]=f.arcs
  /* 两档只有墨色不同，圆心与半径逐位相同 —— 换档不该让阴影挪窝或换大小。 */
  assert.deepEqual(light,dark)
  assert.notEqual(f.inks[1],darkInk,'light and dark must not use the same shadow ink')
  r.setMode('dark')
  assert.equal(f.arcs.length,3)
  assert.equal(f.inks[2],darkInk,'switching back must restore the dark ink')
  r.dispose()
})

test('mount spans the whole frame and hands the sidebar line to the mask variable',()=>{
  const attrs={}
  const frame={getBoundingClientRect:()=>({left:240,top:0,width:1000,height:900})}
  const body={prepend(){},setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]}}
  /* 位置/尺寸由 `left/top/width/height` 四个独立属性给，所以这里用单独的 style 对象接住；
     画布自己的 getBoundingClientRect 跟着它走，第二轮 resize 才是真实尺寸。 */
  const style={setProperty(k,v){style[k]=v},removeProperty(k){delete style[k]}}
  const canvas={dataset:{},style,setAttribute(){},remove(){this.removed=true},
    getBoundingClientRect:()=>({width:Number.parseFloat(style.width)||0,height:Number.parseFloat(style.height)||0}),
    getContext:()=>({setTransform(){},fillRect(){},clearRect(){},fillText(){},beginPath(){},arc(){},fill(){}})}
  const doc={hidden:false,documentElement:{},body,createElement:()=>canvas,addEventListener(){},removeEventListener(){},
    querySelector:s=>s.includes("[data-slot='root']")?frame:null}
  const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,document:doc,
    window:{devicePixelRatio:1,innerWidth:1240,innerHeight:900,addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},
    ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},
    IntersectionObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
    getComputedStyle:()=>({colorScheme:'dark'}),setTimeout:()=>0,clearTimeout(){},
    requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
  vm.runInContext(source,context)
  const dispose=context.UniverseBlackHole.mount()
  assert.equal(typeof dispose,'function')
  /* 框固定在视口左缘、整窗宽、frame 高：换页不改尺寸，也就不会重建网格。 */
  assert.equal(canvas.style.left,'0px');assert.equal(canvas.style.top,'0px')
  assert.equal(canvas.style.width,'1240px');assert.equal(canvas.style.height,'900px')
  /* 左栏隔离交给 mask 斜坡的起点：画布盖住左栏，但斜坡左边那段 alpha 是 0。 */
  assert.equal(canvas.style['--uni-hole-edge'],'240px')
  assert.equal(attrs['data-uni-black-hole'],'')
  dispose()
  assert.equal(canvas.removed,true);assert.equal(attrs['data-uni-black-hole'],undefined)
})

test('换页与右栏展开都不改取景框：宽高恒等于 frame，只有 --uni-hole-edge 在动',()=>{
  /* 2026-10-29 甲方案（用户原话 m02133「甲，弧就停在现在的位置就行」）：取景框固定成整个
     frame，两页共用一块画布、一份网格，位置全交给 viewX，左栏的隔离交给 mask 斜坡的起点
     --uni-hole-edge。以前「左边界只认 column 左边、右边界认 frame 右边」的做法在出画时必须
     把框换成视口，换框就要重建近两万格子，重建期画布是空的、CSS 还把 canvas 藏起来，
     洞会闪一帧 —— 正好闪在转场最显眼的那一帧，所以作废。 */
  function mountWith(columnRect, frameRect) {
    const attrs={}
    const style={setProperty(k,v){style[k]=v},removeProperty(k){delete style[k]}}
    const column={getBoundingClientRect:()=>columnRect}
    const frame={getBoundingClientRect:()=>frameRect}
    const canvas={dataset:{},width:0,height:0,style,setAttribute(){},remove(){},
      getBoundingClientRect:()=>({width:Number.parseFloat(style.width)||0,height:Number.parseFloat(style.height)||0}),
      getContext:()=>({setTransform(){},save(){},restore(){},fillRect(){},clearRect(){},fillText(){},beginPath(){},arc(){},fill(){}})}
    const doc={hidden:false,documentElement:{},
      body:{prepend(){},setAttribute:(k,v)=>{attrs[k]=v},removeAttribute:k=>{delete attrs[k]}},
      createElement:()=>canvas,addEventListener(){},removeEventListener(){},
      querySelector:s=>s==="[data-slot='root'] > * > div:has(> [data-slot='main'])"?column
        :s==="[data-slot='root'] > *"?frame:null}
    const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,document:doc,
      window:{devicePixelRatio:1,innerWidth:frameRect.width,innerHeight:frameRect.height,
        addEventListener(){},removeEventListener(){},
        matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},
      ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},
      IntersectionObserver:class{observe(){}disconnect(){}},MutationObserver:class{observe(){}disconnect(){}},
      getComputedStyle:()=>({colorScheme:'dark'}),setTimeout:()=>0,clearTimeout(){},
      requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
    vm.runInContext(source,context)
    const dispose=context.UniverseBlackHole.mount()
    const box={left:style.left,top:style.top,width:style.width,height:style.height,edge:style['--uni-hole-edge']}
    dispose()
    return box
  }
  /* 真机 1256px 视口：左栏 0..280，对话区 280..1256，右栏收起。 */
  const wide=mountWith({left:280,top:0,width:976,height:821},{left:0,top:0,width:1256,height:821})
  assert.deepEqual(wide,{left:'0px',top:'0px',width:'1256px',height:'821px',edge:'280px'})
  /* 右栏展开：对话区被压到 280..880。框一个像素都不许动，否则展开右栏就会重建网格；
     变的是斜坡起点，而它本来就等于 column 左边（还是 280），所以也不需要动。 */
  const narrow=mountWith({left:280,top:0,width:600,height:821},{left:0,top:0,width:1256,height:821})
  assert.deepEqual(narrow,wide)
})

test('mount publishes the canvas clear colour the sidebar is painted with',()=>{
  /* 2026-10-29：theme.css 把左栏漆成 `--cp-void`（画布清屏色），值由这里按模式发布到
     documentElement 上；缺了这一步自检照样绿，但左栏会退回官方底纱，割裂感原样回来。 */
  function mountWith(scheme) {
    const props={}
    const rootStyle={setProperty:(k,v)=>{props[k]=v},removeProperty:k=>{delete props[k]}}
    const frame={getBoundingClientRect:()=>({left:280,top:0,width:976,height:900})}
    const canvas={dataset:{},style:{setProperty(){},removeProperty(){}},setAttribute(){},remove(){},
      getBoundingClientRect:()=>({width:976,height:900}),
      getContext:()=>({setTransform(){},save(){},restore(){},fillRect(){},clearRect(){},fillText(){},beginPath(){},arc(){},fill(){}})}
    const doc={hidden:false,documentElement:{style:rootStyle},
      body:{prepend(){},setAttribute(){},removeAttribute(){}},
      createElement:()=>canvas,addEventListener(){},removeEventListener(){},
      querySelector:s=>s.includes("[data-slot='root']")?frame:null}
    const context=vm.createContext({performance,console,Math,Number,Object,Float32Array,document:doc,
      window:{devicePixelRatio:1,innerWidth:1256,innerHeight:900,
        addEventListener(){},removeEventListener(){},
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

/* ================= 第二十二阶段：数值与事件回归 =================
   下面这些参考半径不来自本文件的实现，而来自一个独立的 Binet 积分器（轨道平面上积分
   u'' + u = 3u²，DP5(4)、tol 1e-10、角步长 ≤0.04、y=0 节点精确落步、事件用二分定位）。
   它是本阶段的一次性交叉验证工具，没有进仓；把容差再收紧到 tol 1e-12 / 步长 .01，
   除 0.34125 那条临界射线外的参考值漂移都 < 1e-8M（那条本身对小初值敏感，见下），
   所以这些常数是钉死的，容差可以从旧的「半径 6..20」收紧到 1e-5M。
   关键几条还做过三方法互验：同一射线用固定步长 RK4（h=1e-2…1e-5 收敛）与上述 Binet
   分档重算，彼此差 < 1e-8M（盘缘 15.002660760 那条即如此定值）。
   这里的用例全部是修复前失败、修复后通过的：旧实现（变步长 velocity-Verlet、线性插值
   求平面交点、420 步耗尽与逃逸同码）在这些射线上漏盘、错判终态或偏出 1e-5M 以上。 */
const REF_TOL=1e-5
function close(actual,expected,tol,what){
  assert.ok(Number.isFinite(actual),`${what}: 应当命中盘，实际没有交点`)
  assert.ok(Math.abs(actual-expected)<=tol,`${what}: ${actual} 与参考 ${expected} 差 ${Math.abs(actual-expected)}`)
}
test('已知漏盘射线 (0,0.34125) 在修复后命中盘，交点半径与独立参考一致',()=>{
  const {api}=fixture()
  /* 修复前：trace 返回 { captured:false }，整条射线当逃逸处理，盘上少一格。
     它贴着临界曲线，参考值本身 1e-10→1e-12 就差 2.57e-6M，所以这里按 1e-3 断言
     （新实现与最细参考差 3.03e-5M；这个偏差随容差收紧单调下降，但不是线性收敛，
     不能拿「tol 小一个量级」去推别的目标，见源码 STEP_TOL 处的说明）。 */
  const ray=api.trace(0,.34125,15)
  assert.equal(ray.terminal,'disk')
  assert.equal(ray.captured,false)
  close(ray.radius,7.719197222378511,1e-3,'临界漏盘射线')
  assert.ok(ray.radius>6&&ray.radius<16)
})
test('临界曲线两侧逐档判定一致：解析临界半径落在数值边界的同侧一格之内',()=>{
  const {api}=fixture()
  /* 解析临界（当前相机初值）u=0 时 v=0.341239242464。修复前整条边界偏到 0.340529862943，
     差了 7e-4 —— 阴影边缘因此比物理值小 0.29px。现在边界落在 (0.341239,0.341240) 之间，
     与解析值相差不到 1e-6。 */
  for(const v of [.30,.33,.3412,.341239]){
    const ray=api.trace(0,v,15)
    assert.equal(ray.terminal,'capture',`v=${v} 应当在阴影内被捕获`)
    assert.equal(ray.radius,undefined)
  }
  for(const v of [.34124,.34125,.3413,.345]){
    const ray=api.trace(0,v,15)
    assert.notEqual(ray.terminal,'capture',`v=${v} 应当已经出阴影`)
  }
  assert.equal(api.trace(0,.34125,15).terminal,'disk','刚出阴影的这一格必须先命中盘')
  assert.equal(api.trace(0,.3413,15).terminal,'escape','再往外就只剩逃逸，不该有盘交点')
  /* 边界断言：实测被判捕获的最大 v 必须小于解析临界值，被判逃逸的最小 v 必须大于它。
     修复前边界偏到 0.340529862943，这条会在 Math.max(inside) < V_CRIT 上失败。 */
  const V_CRIT=.341239242464
  const inside=[.30,.33,.3412,.341239].filter(v=>api.trace(0,v,15).terminal==='capture')
  const outside=[.34124,.34125,.3413,.345].filter(v=>api.trace(0,v,15).terminal!=='capture')
  assert.equal(inside.length,4,'四条内侧采样都应判捕获')
  assert.equal(outside.length,4,'四条外侧采样都不该判捕获')
  assert.ok(Math.max.apply(null,inside)<V_CRIT&&V_CRIT<Math.min.apply(null,outside),
    `解析临界 ${V_CRIT} 没落在数值边界 (${Math.max.apply(null,inside)},${Math.min.apply(null,outside)}) 之间`)
})
test('历史 22 条误判逐条修正：可见性与终态都与独立参考一致',()=>{
  const {api}=fixture()
  /* 第二十一阶段的 12 条可见性误判 + 12 条终态误判（两组重合 2 条，并集 22 条）。
     左右成对，这里只写一组 u，镜像在循环里逐个跑，两侧都必须一致。
     末列是参考终态：'escape'/'capture' 表示沿光线到无穷远也没有盘内交点；
     'disk' 表示首个盘内交点（不透明薄盘，遇到即停，不再叠加后面的交点）。 */
  const rows=[
    [-0.152349377,0.65408805,null,'escape'],
    [-0.266611409,0.352201258,null,'escape'],
    [0.063478907,0.339622642,null,'escape'],
    [-0.177740939,0.301886792,15.027047208931727,'disk'],
    [0.330090316,0.088050314,6.983314051369235,'disk'],
    [-0.292002972,0.176100629,null,'capture'],
    [-0.025391563,0.339622642,null,'capture'],
    [-0.215828283,0.264150943,null,'capture'],
    [-0.292002972,-0.176100629,9.61002970555677,'disk'],
    [-0.215828283,-0.264150943,12.69887628051936,'disk'],
    [-0.025391563,-0.339622642,15.133147461916979,'disk']
  ]
  let checked=0
  for(const [u,v,refRadius,refTerminal] of rows)for(const su of [u,-u]){
    const ray=api.trace(su,v,15),label=`(${su},${v})`
    checked++
    assert.equal(ray.terminal,refTerminal,`${label} 终态`)
    assert.equal(ray.captured,refTerminal==='capture',`${label} captured 标志`)
    if(refRadius===null){
      assert.equal(ray.radius,undefined,`${label} 不该有盘交点`)
    }else{
      close(ray.radius,refRadius,REF_TOL,label)
      assert.ok(ray.radius>=6&&ray.radius<=16,`${label} 交点必须落在 6..16M`)
    }
  }
  assert.equal(checked,22,'这一组必须覆盖全部 22 条历史误判')
})
test('盘缘、外盘与高阶路径的抽样：交点半径对齐参考，盘缘判据不靠余量',()=>{
  const {api}=fixture()
  const rows=[
    [0.528636384,-0.240963855,13.175659340],   /* 全网格误差最大的一格（5.3e-7M） */
    [0.656790659,-0.240963855,13.977014456],
    [0.544655668,0.120481928,7.575862640],
    [-0.865041356,-0.192771084,14.373862200],
    [0.080096422,-0.506024096,15.733862111],
    [-0.160192844,0.650602410,15.901028140],   /* 贴着外缘 16M */
    /* 盘缘：这一格的交点半径 15.002660760 由三种方法互相验过 —— 独立 RK4 步长 1e-2…1e-5
       收敛到 15.002660760(1)，Binet 参考 tol 1e-13 收敛到 15.0026607601，本实现 15.002660920。 */
    [0,0.6506,15.002660760]
  ]
  for(const [u,v,ref] of rows){
    const ray=api.trace(u,v,15)
    close(ray.radius,ref,REF_TOL,`(${u},${v})`)
    assert.ok(ray.radius<=16,`(${u},${v}) 不许溢出 OUTER`)
    assert.equal(ray.terminal,'disk')
  }
  /* 盘外穿越不许终止追踪：这条射线第一次 y=0 穿越在 16M 之外，之后才在 15.9M 命中，
     所以「交点半径 <=16」本身就证明它没有被第一次盘外穿越拦下。 */
  assert.ok(api.trace(-0.160192844,0.650602410,15).radius>15)
  /* 真正逃逸的：一次盘内交点都没有，也不许报成捕获。 */
  for(const [u,v] of [[-0.048057853,0.433734940],[0,0.8],[0,-0.8]]){
    const ray=api.trace(u,v,15)
    assert.equal(ray.terminal,'escape',`(${u},${v}) 应当逃逸`)
    assert.equal(ray.captured,false)
    assert.equal(ray.radius,undefined)
  }
})
test('trace 的四种终态互斥且可区分：步数预算耗尽不等于物理逃逸',()=>{
  const {api}=fixture()
  const seen={}
  for(let y=-.8;y<=.8;y+=.02){
    const ray=api.trace(0,y,15)
    assert.ok(['disk','capture','escape','exhausted'].includes(ray.terminal),`未知终态 ${ray.terminal}`)
    assert.equal(ray.captured,ray.terminal==='capture',`captured 只对 'capture' 为真`)
    assert.equal(ray.radius!==undefined,ray.terminal==='disk',`radius 只在 'disk' 上出现`)
    seen[ray.terminal]=1
  }
  assert.ok(seen.disk&&seen.capture&&seen.escape,'竖直扫过阴影应当同时见到命中、捕获与逃逸')
  /* 把预算压到 4 步：朝洞心的射线本来要 80 步以上，现在必须报 exhausted 而不是 escape。
     修复前这两种情况返回的是同一个 { captured:false }，调用方无从区分。 */
  const tight=source.replace('var STEP_BUDGET = 2400','var STEP_BUDGET = 4')
  assert.notEqual(tight,source,'预算那行必须还能被找到，否则这条用例形同虚设')
  const short=fixture(tight).api.trace(0,.1,15)
  assert.equal(short.terminal,'exhausted')
  assert.equal(short.captured,false)
  assert.equal(short.radius,undefined)
  assert.equal(short.steps,4,`预算 4 步时就该正好停在 4 步，实际 ${short.steps}`)
})
test('字符层：没有环层时环带里的有效盘格照常落字，被捕获的格子一个都不落',()=>{
  /* 第三十一阶段起，环带让位只在「环层烘出来了」时生效：边缘包络来自 bakeRing，
     没有 offscreen canvas（测试桩、精简 DOM、烘焙失败）就没有包络，也就不该为不存在的环
     清掉盘面。这条用例走纯 ASCII 那条路，锁住「不排除」这一半行为。
     另一条用例（下面）开 canvas2d，锁住「有环时让位」那一半。 */
  const f=fixture(null,{width:640,height:360}),r=f.api.create(f.canvas)
  f.drain();assert.equal(r.stats().ready,true)
  const W=640,H=360,short=Math.min(W,H)
  let cw=Math.max(6,Math.sqrt(W*H/(16000*1.5)))
  const cols=Math.max(1,Math.floor(W/cw));cw=W/cols
  const rows=Math.max(1,Math.floor(H/(cw*1.5)));const ch=H/rows
  /* 半径与 src 同源：SHADOW_SHARE 只定视场，阴影半径由有限距离临界投影给出。 */
  const CRIT_RATIO=3*Math.sqrt(3)/Math.sqrt(60*60-(1-2/60)*27)/(3*Math.sqrt(3)/60/0.34)
  const horizon=CRIT_RATIO*short/2,baseX=W/2,baseY=H/2
  assert.ok(f.placed.length>0,'应当画出字符')
  const hit=new Set(),band=new Set(),inside=new Set()
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const u=(2*(col+.5)*cw-W)/short,v=(H-2*(row+.5)*ch)/short
    if(!f.api.trace(u,v,15).radius)continue
    hit.add(col+','+row)
    const gx=(col+.5)*cw-baseX,gy=(row+.5)*ch-baseY,gd=Math.sqrt(gx*gx+gy*gy)
    if(gd>=horizon-1&&gd<=150)band.add(col+','+row)
    if(gd<horizon-1)inside.add(col+','+row)
  }
  const at=new Map()
  for(const p of f.placed){
    const col=Math.round(p.x/cw-.5),row=Math.round(p.y/ch-.5)
    at.set(col+','+row,p)
  }
  /* 落字的每一格都必须真的有盘交点：遮挡没有放松，没有交点的格子照样一个字都不落。 */
  for(const key of at.keys())assert.ok(hit.has(key),`${key} 没有盘交点却落了字`)
  /* 没有环层时不排除：旧规则下这里必须是 0，现在是 570 格里的绝大多数。 */
  let inBand=0
  for(const key of at.keys())if(band.has(key))inBand++
  assert.ok(inBand>300,`环带里只落了 ${inBand} 格字，没有环层却在让位`)
  assert.ok(inBand<=band.size)
  /* 阴影圆内部那几格是近侧盘面压在洞前，改动前后都照常落字（不属于本阶段范围）。 */
  assert.ok(inside.size>0,'这个窗口应当有投影落在阴影圆内的近侧盘面')
  /* 覆盖率：除了 shade 恰好压在 .004 门槛上的极少数格，有交点的格子都该落字。 */
  assert.ok(hit.size-at.size<=Math.ceil(hit.size*.02),`有交点 ${hit.size} 格，实际落字 ${at.size} 格`)
  r.dispose()
})
test('字符层：环层就绪后环上的盘格全部让位，环外照常落字',()=>{
  /* 第十五阶段把环交给 Canvas 精细层之后，盘格在环的位置上照常显影，环从字缝里透出来，
     读成一圈零散杂点。这里在 shade 之前跳过环带里的盘格。
     边界不能是固定像素：环峰随方位在 140..215px 之间移动，下方被前景盘拉出一段外扩。
     生产按 bakeRing 记下的方位包络 edge[方位] 查表，只清环真有像素的方向。 */
  const f=fixture(null,{width:640,height:360},{canvas2d:true}),r=f.api.create(f.canvas)
  f.drain();assert.equal(r.stats().ready,true)
  const ring=r.stats().ring
  assert.ok(ring,'环层必须烘出来，否则这条用例测不到让位逻辑')
  assert.equal(ring.state,'ready')
  assert.ok(ring.edgeMax>0&&ring.edge instanceof Float32Array,'方位包络必须随环层一起发布')
  const BINS=ring.edge.length
  const W=640,H=360,short=Math.min(W,H)
  let cw=Math.max(6,Math.sqrt(W*H/(16000*1.5)))
  const cols=Math.max(1,Math.floor(W/cw));cw=W/cols
  const rows=Math.max(1,Math.floor(H/(cw*1.5)));const ch=H/rows
  const CRIT_RATIO=3*Math.sqrt(3)/Math.sqrt(60*60-(1-2/60)*27)/(3*Math.sqrt(3)/60/0.34)
  const horizon=CRIT_RATIO*short/2,baseX=W/2,baseY=H/2
  /* 与生产同一个字符格让位余量：格心到格角再加 1px。 */
  const clear=Math.sqrt(cw*cw+ch*ch)/2+1
  const at=new Map()
  for(const p of f.placed){
    const col=Math.round(p.x/cw-.5),row=Math.round(p.y/ch-.5)
    at.set(col+','+row,p)
  }
  assert.ok(at.size>0,'环外必须还有字')
  let banded=0,outside=0
  for(const key of at.keys()){
    const parts=key.split(','),col=Number(parts[0]),row=Number(parts[1])
    const gx=(col+.5)*cw-baseX,gy=(row+.5)*ch-baseY,gd=Math.sqrt(gx*gx+gy*gy)
    /* 阴影圆内那几格是近侧盘面压在洞前，不属于环，生产也不排除。 */
    if(!(gd>horizon))continue
    const bin=(((Math.atan2(gy,gx)+Math.PI)/(Math.PI*2)*BINS)|0)%BINS
    if(gd<=ring.edge[bin]+clear)banded++
    else outside++
  }
  assert.equal(banded,0,`环带里还有 ${banded} 格字，让位没有生效`)
  assert.ok(outside>100,`环外只剩 ${outside} 格字，让位连带把盘面挖空了`)
  r.dispose()
})
/* ================= 第二十三阶段：耗尽语义闭环与角度边界 =================
   第二十二阶段只让 trace 能返回 'exhausted'，消费者没跟上：
     · chunk 拿到耗尽格照样置 ready=true；
     · stats 里没有任何耗尽诊断；
     · bakeRing 只看 captured，没算完的射线照样往环遮罩里写 alpha。
   这里把两条消费链各测两遍（正常预算 / 耗尽注入），并补 10°、50° 两个支持边界的
   独立参考样本。注入只改 STEP_BUDGET 这一行常量，不碰初值、容差、几何。 */
const injectBudget = n => {
  const out = source.replace('var STEP_BUDGET = 2400', `var STEP_BUDGET = ${n}`)
  assert.notEqual(out, source, '预算那行必须还能被找到，否则注入形同虚设')
  return out
}
const alphaPixels = imgs => {
  let n = 0
  for (const img of imgs) for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) n++
  return n
}
test('消费者契约：耗尽格让网格失败闭合，不冒充 ready，也不落半个字', () => {
  /* 正常预算：网格与诊断都必须是 ready，耗尽计数为 0。 */
  const ok = fixture()
  const r1 = ok.api.create(ok.canvas)
  ok.drain()
  const s1 = r1.stats()
  assert.equal(s1.ready, true)
  assert.equal(ok.canvas.dataset.blackHoleState, 'ready')
  assert.equal(s1.build.state, 'ready')
  assert.equal(s1.build.rays, s1.cells, '诊断里的射线数必须等于格数')
  assert.equal(s1.build.exhausted, 0)
  assert.equal(s1.build.retried, 0)
  assert.equal(s1.build.unresolved, 0)
  assert.equal(s1.build.budget, 2400)
  assert.ok(ok.painted.length > 0)

  /* 耗尽注入（4 步）：一条射线都算不完。修复前这里 ready=true、照常落字。 */
  const bad = fixture(injectBudget(4))
  const r2 = bad.api.create(bad.canvas)
  bad.drain()
  const s2 = r2.stats()
  assert.equal(s2.ready, false, '耗尽后不得报告 ready')
  assert.equal(bad.canvas.dataset.blackHoleState, 'failed', '画布状态必须显式失败，不能停在 building 或 ready')
  assert.equal(s2.build.state, 'failed')
  assert.equal(s2.build.rays, s2.cells)
  assert.ok(s2.build.exhausted > 0, '注入下必须真的出现耗尽')
  assert.equal(s2.build.retried, s2.build.exhausted, '只允许对耗尽格重算一次，且只重算耗尽格')
  assert.ok(s2.build.unresolved > 0, '4 步预算下重算也救不回来，必须留下未解决计数')
  assert.equal(bad.painted.length, 0, '失败态不许把没算完的格子当盘或当作逃逸落字')
  assert.equal(bad.frames.size, 0, '失败态不启动动画帧')
  assert.equal(bad.timers.size, 0, '失败态不留待执行的重建任务')
  /* 有限恢复确实生效：60 步预算下大部分耗尽格被翻倍预算救回，剩下的才失败。
     这条断言同时证明「重算」不是空转。 */
  const mid = fixture(injectBudget(60))
  const r3 = mid.api.create(mid.canvas)
  mid.drain()
  const s3 = r3.stats()
  assert.ok(s3.build.exhausted > 0 && s3.build.unresolved < s3.build.exhausted,
    `有限恢复没有起作用：exhausted=${s3.build.exhausted} unresolved=${s3.build.unresolved}`)
  assert.equal(s3.ready, false)
})
test('消费者契约：环缓存只要有耗尽射线就整张不发布', () => {
  /* 正常预算：320×200 的遮罩照常烘焙并发布。304 是这一档尺寸下 alpha>0 的像素数。
     第二十二阶段的基线是 340；第二十六阶段把阴影半径从 0.34 的取整改成有限距离
     临界投影 rho_c(=0.341239) 后，这一档的采样窗口仍是 120²（ceil(34*1.75)*2 与
     ceil(34.1239*1.75)*2 都取 120），变化来自 plot 的两条像素阈值——rad<horizon+.5
     跳过、rad<horizon+1.5 淡入——随半径一起外移 0.124px，窗口内被判为可绘的像素因此
     减少约 9%，alpha>0 的计数按预期变成 304（不是回归），此后同一尺寸下逐位可复现。 */
  const ok = fixture(null, { width: 320, height: 200 }, { canvas2d: true })
  const r1 = ok.api.create(ok.canvas)
  ok.drain()
  const s1 = r1.stats()
  assert.equal(s1.ring.state, 'ready')
  assert.ok(s1.ring.attempted > 0)
  assert.equal(s1.ring.exhausted, 0)
  assert.equal(s1.ring.retried, 0, '默认预算下不需要任何重算')
  assert.equal(s1.ring.unresolved, 0)
  assert.ok(s1.ring.drawn > 0, '正常预算下必须有像素被写进遮罩')
  assert.equal(ok.bakes.length, 1, '只有完整烘完的遮罩才会被提交')
  assert.equal(alphaPixels(ok.bakes), 304, '正常路径的环像素数必须与基线逐像素相同')
  assert.ok(alphaPixels(ok.bakes) <= s1.ring.drawn)

  /* 翻倍预算救得回来的情形：整张遮罩必须救回来，而不是因为一条近临界射线就整层消失。
     这条同时验证「重算走的是同一条落笔判据」—— 救回来的遮罩与默认预算逐像素相同。 */
  const saved = fixture(injectBudget(120), { width: 320, height: 200 }, { canvas2d: true })
  const rs = saved.api.create(saved.canvas)
  saved.drain()
  const ss = rs.stats()
  assert.equal(ss.ring.state, 'ready')
  assert.ok(ss.ring.exhausted > 0, '120 步预算下确实有射线首轮算不完')
  assert.equal(ss.ring.retried, ss.ring.exhausted, '每个耗尽像素只重算一次')
  assert.equal(ss.ring.unresolved, 0)
  /* drawn 与 attempted 相等：环层的落笔判据只看 trace 的 ring 权重，不看盘命中。
     盘命中像素照常写进遮罩，字符层靠 draw() 的方位包络单独让位。 */
  assert.equal(ss.ring.drawn, ss.ring.attempted)
  assert.equal(saved.bakes.length, 1)
  assert.equal(alphaPixels(saved.bakes), 304, '重算救回的遮罩必须与默认预算逐像素相同')

  /* 耗尽注入：修复前这张遮罩照样提交，320×200 上留下 340 个非零 alpha 像素
     （现基线 304，原因同上） */
  const bad = fixture(injectBudget(4), { width: 320, height: 200 }, { canvas2d: true })
  const r2 = bad.api.create(bad.canvas)
  bad.drain()
  const s2 = r2.stats()
  assert.equal(s2.ring.state, 'incomplete', '有射线没算完，遮罩状态必须显式不完整')
  assert.ok(s2.ring.exhausted > 0)
  assert.equal(s2.ring.retried, s2.ring.exhausted)
  assert.equal(s2.ring.unresolved, s2.ring.exhausted, '4 步预算下重算也救不回来')
  assert.equal(s2.ring.drawn, 0, '不完整的遮罩一个像素都不能发布')
  assert.equal(bad.bakes.length, 0, 'putImageData 都不许发生')
  assert.equal(alphaPixels(bad.bakes), 0, '失败分支不许产生任何非零 alpha 像素')
  /* 低预算下一条射线都走不到落像素那一步，discarded 自然是 0；预算抬到 100 步才真会
     「已经画出来了、之后才发现有射线没算完」。这时必须把丢掉的数量报出来，
     否则从 stats 上看不出整张遮罩是被丢弃的。 */
  const part = fixture(injectBudget(100), { width: 320, height: 200 }, { canvas2d: true })
  const r3 = part.api.create(part.canvas)
  part.drain()
  const s3 = r3.stats()
  assert.equal(s3.ring.state, 'incomplete')
  assert.ok(s3.ring.exhausted > 0)
  assert.ok(s3.ring.unresolved > 0)
  assert.ok(s3.ring.discarded > 0, `已画出的像素必须留下丢弃计数，实际 ${s3.ring.discarded}`)
  assert.equal(s3.ring.drawn, 0)
  assert.equal(part.bakes.length, 0, '半张遮罩不许提交')
})
test('精确端点事件：y=0 落在步端只算一次，不会与上一步重复计数', () => {
  /* crossFraction 是生产私有函数，不为了测试把它挂进公开导出：这里在内存源码里
     只给导出行补一个名字，生产文件一个字都不改。 */
  const exposed = source.replace("debugSource: 'v3' }", "debugSource: 'v3', crossFraction: crossFraction }")
  assert.notEqual(exposed, source, '导出行必须还能被找到')
  const { api } = fixture(exposed)
  assert.equal(typeof api.crossFraction, 'function')
  /* 步端恰好落在 y=0：交点就是本步终点。修复前返回 -1，这个交点在两步之间被漏掉。 */
  assert.equal(api.crossFraction(1, -1, 0, -1, 1), 1)
  /* 本步起点就在 y=0：那个交点属于上一步终点、已经计过，这里必须拒绝，避免重复计数。 */
  assert.equal(api.crossFraction(0, -1, -1, -1, 1), -1)
  /* 普通严格异号：根在开区间内。 */
  const mid = api.crossFraction(1, -1, -1, 1, 1)
  assert.ok(mid > 0 && mid < 1, `对称情形的根应在 (0,1) 内，实际 ${mid}`)
  /* 同号不造假事件。 */
  assert.equal(api.crossFraction(1, 0, 2, 0, 1), -1)
  assert.equal(api.crossFraction(-1, 0, -2, 0, 1), -1)
  /* 一次穿越跨两步的记账：A 步从 y=1 落到 y=0 → 计一次；B 步从 y=0 出发 → 不再计。 */
  assert.deepEqual([api.crossFraction(1, -1, 0, -1, 1) > 0, api.crossFraction(0, -1, -1, -1, 1) > 0], [true, false])
  /* 外层门（trace 里的 if）也必须认步端交点，否则 crossFraction 的端点约定永远走不到。 */
  assert.match(source, /if \(y \* NEXT\[1\] < 0 \|\| \(NEXT\[1\] === 0 && y !== 0\)\)/,
    'trace 的事件门必须同时接受严格异号与「本步终点落在 y=0」')
})
test('支持角度边界 10°/50°：盘缘两侧、临界邻侧与高阶盘像对齐独立参考', () => {
  /* 参考积分器：轨道平面 Binet u''+u=3u²，DP5(4)、tol 1e-12、角步长 ≤0.01、y=0 节点精确
     落步、事件用二分定位。它与生产实现共用同一套 DP5(4) 系数表和「二分定位事件」的思路，
     所以不是完全独立的第三方口径；状态变量（2 维轨道平面 vs 6 维笛卡尔）、坐标、盘面判据
     与捕获/逃逸事件都是独立写的。关键几条另用固定步长 RK4（h=5e-4）核过：
     盘缘命中那几条与 Binet 差 1e-9～1e-11M，说明参考值不是 DP45 自身算法的产物；
     临界邻侧那两条本身对 1e-16 的初值扰动敏感，RK4 与 Binet 会差到 5e-3M，
     所以那两条只断言终态、不断言半径。
     u,v 保留完整双精度（未四舍五入），观测偏差 dProd 在 8.0e-8～2.0e-7M 之间。
     这两个角度不是随便挑的：options() 把 angle 夹在 [10,50]，10° 与 50° 就是支持的边界。 */
  const { api } = fixture()
  const TOL23 = 1e-6
  const rows = [
    /* [angle, u, v, 参考终态, 参考首个盘内交点半径(null=无), 说明] */
    [10, 0, .431, 'escape', null, '内缘外侧：首个平面交点 5.9953856382049375M 落在 6M 以内，不算命中，射线继续'],
    [10, 0, .434, 'disk', 6.1023668060835075, '内缘内侧：首个平面交点 6.10M，命中'],
    [10, 0, .635, 'disk', 15.832144807501463, '外缘内侧'],
    [10, 0, .638, 'escape', null, '外缘外侧：首个平面交点 16.02155733178818M 越过 16M，不算命中'],
    [10, 0, -.535, 'disk', 15.999054815567503, '高阶盘像：先在 26.540497363819885M 穿越一次（盘外不终止），第二次才命中'],
    [10, 0, .3411392425050419, 'capture', null, '临界邻侧（内侧，距临界 -1e-4）'],
    [10, 0, .3413392425050419, 'escape', null, '临界邻侧（外侧，距临界 +1e-4）'],
    [50, 0, .476, 'escape', null, '内缘外侧：首个平面交点 5.988769391612248M'],
    [50, 0, .479, 'disk', 6.046937605906586, '内缘内侧'],
    [50, 0, .929, 'disk', 15.98411293137068, '外缘内侧'],
    [50, 0, .932, 'escape', null, '外缘外侧：首个平面交点 16.058257256045188M'],
    [50, 0, .35, 'disk', 6.198176252312114, '高阶盘像：先在 3.6612659839934767M 穿越一次，第二次命中 6.2M'],
    [50, 0, .3411392424792922, 'capture', null, '临界邻侧（内侧）'],
    [50, 0, .3413392424792922, 'escape', null, '临界邻侧（外侧）']
  ]
  let diskChecked = 0
  for (const [angle, u, v, term, ref, why] of rows) {
    const ray = api.trace(u, v, angle)
    const label = `${angle}° (${u},${v}) ${why}`
    assert.equal(ray.terminal, term, `${label} 终态`)
    assert.equal(ray.captured, term === 'capture', `${label} captured 标志`)
    if (ref === null) {
      assert.equal(ray.radius, undefined, `${label} 不该有盘交点（不得把 y=0 事件直接当命中）`)
    } else {
      diskChecked++
      close(ray.radius, ref, TOL23, label)
      assert.ok(ray.radius >= 6 && ray.radius <= 16, `${label} 交点必须落在 6..16M`)
    }
  }
  assert.equal(diskChecked, 6, '两个边界角度各有 3 条命中样本，缺一条就说明表被改了')
})
/* ================= 第二十六阶段：A1 频移永久回归 =================
   缺口：把 SQRT_FD 从 √(1-2/60) 改成 1，此前 17 项黑洞用例全绿。原因是用例只断言 boost>0，
   而旧契约 boost=clamp(g^1.8,.4,1.7) 同时扛着「限幅」和「归一化缺失」两件事：少了 √(1-2/D)，
   (.51,.14,15°) 的 boost 从 1.5329871431830666 掉到 1.4869199259637647，只差 3.0%，
   仍然 >0、仍然落在限幅区间内，所以没有一条断言会红。

   第二十九阶段把命中记录的权重换成未夹限的 g⁴：同一个归一化缺口让 g⁴ 从 2.5840910128766161
   掉到 2.4146894909213708（差 6.6%），而且 2.584 已经越过旧的 1.7 上限 —— 夹限本身也成了
   可被断言抓住的故障，不再有「落在区间内所以看不出」的盲区。

   读原始 g：只在内存里的源码副本上给 diskHit 的返回对象补 g/axialB 两个字段、给导出行补
   一个名字。磁盘上的生产文件一个字都不改，也不新增生产 API 或生产字段。

   期望来源分三类，独立性不同，不能混着说：
     · 第 1 类是真正独立的：只用相机初值与守恒量的独立积分参考，不含生产实现的任何代数；
     · 第 2 类是与生产公式代数等价、但由守恒量重新推导的闭式，只用来把「同事件公式」和
       「事件定位」两笔误差分开，不能算作第二套独立验证；
     · 第 3 类是解析理想情况，只钉限幅边界。
     1. 阶段24 的 3 维笛卡尔 RK4 参考：局部正交标架给出的 μ 与只用初始守恒量的 μ 两条路径
        互差 ≤1e-9，事件在 RK4 子步内用 62 次二分定位，dt=0.02/0.01 两档。下表 rRef/gRef
        是 dt=0.01 那一档的值。
     2. 零轴向解析式：u=0 ⇒ Jy0=0 ⇒ g=√(1-3/r)/√(1-2/D)，与 μ 无关。注意右式代入的仍是
        生产给出的事件半径，所以它只验公式、不验轨迹，归第 2 类。
     3. 理想切向解析式：μ=±1、r=6（β=1/2）时 g 也是闭式。它只把解析值钉到生产公式上，
        不是当前相机的实际射线。

   两个阈值必须分开：
     A1_SAME=1e-12 —— 同一个事件上「生产公式 vs 独立闭式」的代数一致性。它共用生产给出的
                     事件半径，所以不含轨迹误差；同事件代数重排不能冒充第二套局部标架。
     A1_SHIFT=1e-6 / A1_RADIUS=1e-5 —— 生产轨迹与独立参考之间的误差预算。前者比参考自身
                     的 dt 收敛残差（n3 档 2.43e-8）大 40 倍，比归一化缺失造成的 1.7% 小四个
                     量级；后者只比最大实测偏差（3.23e-6M，同样来自 n3 档）大 3 倍。
                     把 1e-12 直接套到生产轨迹上会立刻误报，所以这两个数不是同一个量。 */
const A1_SAME=1e-12,A1_SHIFT=1e-6,A1_RADIUS=1e-5
/* 第二十九阶段：命中记录的权重是未夹限的 g⁴，锚点就是返回行上的 g4 字段。原始 g 只在
   内存源码副本里补回来，生产文件不多一个字段，也没有测试专用的生产 API。 */
const A1_G4_LINE='g4: g4,'
const A1_G4_CALC='var g4 = g * g * g * g'
const A1_EXPORT_LINE="debugSource: 'v3' }"
function a1Source(src){
  /* 不只是「找得到」，还要「只有一处」：replace 命中首个匹配，若将来出现第二个相同的字段行，
     注入可能落进别的函数而断言仍然碰巧变绿。 */
  assert.equal(src.split(A1_G4_LINE).length,2,'diskHit 的 g4 行在生产源里必须恰好一处（注入落点唯一）')
  assert.equal(src.split(A1_EXPORT_LINE).length,2,'列出 debugSource 的那一行必须恰好一处')
  const withG=src.replace(A1_G4_LINE,A1_G4_LINE+' g: g, axialB: axialB,')
  assert.notEqual(withG,src,'diskHit 的 g4 行必须还认得出（注入点找不到说明生产源变了）')
  const withExport=withG.replace(A1_EXPORT_LINE,"debugSource: 'v3', diskHit: diskHit }")
  assert.notEqual(withExport,withG,'导出行必须还认得出；若只是 debugSource 版本号变了，改这里的锚点常量，不要放宽断言')
  return withExport
}
/* 只按 launch 的相机定义独立重写初值：原点在 z-y 平面、三个基向量按 u,v,angle 展开后归一。
   E0=√(1-2h²/D³) 与 Jy0=z·px−x·pz 都是中心场守恒量，不经过任何轨迹积分，也不读生产中间量。 */
function a1Conserved(angle,u,v){
  const D=60,TAN=3*Math.sqrt(3)/D/.34
  const a=angle*Math.PI/180,sa=Math.sin(a),ca=Math.cos(a)
  const px=u*TAN,py=-sa+v*TAN*ca,pz=-ca-v*TAN*sa
  const n=Math.hypot(px,py,pz),ux=px/n,uy=py/n,uz=pz/n
  const ox=0,oy=D*sa,oz=D*ca
  const jx=oy*uz-oz*uy,jy=oz*ux-ox*uz,jz=ox*uy-oy*ux
  const h=Math.hypot(jx,jy,jz)
  return {E0:Math.sqrt(1-2*h*h/(D*D*D)),jy0:jy,h}
}
/* A1 频移闭式 g=√(1-3/r)/(√fD·(1-βμ))，β=√(1/(r-2))；μ 由守恒量给 μ=√f·Jy0/(r·E0)。 */
function a1Closed(r,mu){return Math.sqrt(1-3/r)/(Math.sqrt(1-2/60)*(1-Math.sqrt(1/(r-2))*mu))}
function a1Mu(radius,jy0,E0){return Math.sqrt(1-2/radius)*jy0/(radius*E0)}
test('A1 观察者归一化：(.51,.14,15°) 的原始 g、g⁴ 与有符号 Jy0/E0 同时被钉住',()=>{
  const {api}=fixture(a1Source(source))
  const c=a1Conserved(15,.51,.14)
  /* 先自检独立期望本身，避免期望写错还去断言生产：E0 与有符号 Jy0 都是钉死的常数。 */
  close(c.E0,0.99970290260939243,1e-15,'独立 E0 自检')
  close(c.jy0,7.4612528187732119,1e-14,'独立 Jy0 自检')
  const ray=api.trace(.51,.14,15)
  assert.equal(ray.terminal,'disk')
  /* 原始 g。这一格的旧 boost=1.5329871431830666 没碰到 1.7 上限，但另外两个理想切向事件两侧
     都被限幅，从旧 boost 逆推 g 在那种样本上直接失真，所以回归一律读原始值。 */
  /* 这里钉的是「生产在当前求解器上的实测原始 g」（golden master），走的是轨迹误差预算 1e-6。
     测试 2 表里的 gRef=1.2678764951154931 是阶段24 RK4 dt=0.01 的独立参考，两者相差 2.29e-9，
     那 2.29e-9 就是生产轨迹的离散化误差 —— 两个数不能互相冒充对方的期望。 */
  close(ray.g,1.2678764974073693,A1_SHIFT,'样本原始 g（生产实测 golden）')
  /* 命中记录只存 g⁴，且没有夹限：这一格的 g⁴=2.5840910128766161 已经越过旧上限 1.7，
     如果 [0.4,1.7] 限幅还在，下面两条立刻红。 */
  assert.ok(ray.g4>1.7,`g⁴ ${ray.g4} 必须越过旧上限 1.7，否则夹限可能还在`)
  close(ray.g4,2.5840910128766161,A1_SHIFT,'样本 g⁴（生产实测 golden）')
  /* g⁴=g·g·g·g 是命中记录本身的定义（同一个返回对象上的两个字段），属于定义一致性，
     不是独立验证；它同时解释了「只断言 boost>0」为什么放过 A1 缺口。 */
  close(ray.g4,Math.pow(ray.g,4),A1_SAME,'g⁴ 与 g 的四次幂关系（定义一致性，非独立验证）')
  /* 漏掉观察者归一化（SQRT_FD→1）时 g 乘上 √fD，g⁴ 落到 2.4146894909213708，相差 6.6%。
     这条负断言把该故障本身钉在永久用例里，而不只是钉住正确值。 */
  assert.ok(Math.abs(ray.g4-2.4146894909213708)>1e-3,
    `g⁴ ${ray.g4} 与归一化缺失的实测值 2.41469 太近，说明 SQRT_FD 没有被正确使用`)
  /* 归一化项的量级：g 整体乘掉 √(1-2/60) 后 g⁴ 就是 2.4146894909213708（即 g⁴·fD²）。
     ray.g4 是轨迹派生量，所以同样只走 1e-6 的轨迹预算（故障差 1.7e-1，比它大五个量级）。 */
  close(ray.g4*Math.pow(1-2/60,2),2.4146894909213708,A1_SHIFT,'去掉 √(1-2/D) 后的 g⁴')
  /* 生产 axialB 必须等于独立 Jy0/E0（含符号）：这一条同时钉住 E0 与有符号归一化，
     把 E0 改成 1 会让它偏 2.2e-3（见交付里的内存故障注入）。 */
  close(ray.axialB,c.jy0/c.E0,A1_SAME,'有符号 Jy0/E0')
  assert.ok(c.jy0>0&&ray.axialB>0,'这一格轴向为正（顺行侧）')
})
test('A1 红移/蓝移/零轴向：15° 六条命中的原始 g 对齐阶段24 独立积分参考，两层阈值分开',()=>{
  const {api}=fixture(a1Source(source))
  const rows=[
    /* [u, v, 参考半径(dt=.01), 参考 g(dt=.01), 独立 Jy0（未除 E0，断言处才除）, 频移, 说明] */
    [.51,.14,7.1802791099634993,1.2678764951154931,7.4612528187732119,'blue','顺行侧蓝移 g>1，g⁴=2.58 越过旧上限'],
    [-.66,.14,9.9197300846025716,0.64970840395411045,-9.6021960719616573,'red','逆行侧红移更深，轴向为负'],
    [.30,-.12,7.4412223352573941,1.0041199591770404,4.4136931934109045,'blue','蓝移但只高过 1 的 0.4%：最容易和 1 混淆的一格'],
    [0,.3415,8.1662426869661484,0.80898019396973209,0,'zero','零轴向：Jy0=0，g 与 μ 无关，退化为闭式'],
    [-.11,.66,15.931415438230522,0.89383049026189376,-1.6007443393786451,'red','贴着外缘 15.93M'],
    [-.32,.12,14.056945333976975,0.82810281933215357,-4.7060595091696786,'red','高阶盘像 n=3：参考自身 dt 残差 2.43e-8，比其它行大四个量级']
  ]
  for(const [u,v,rRef,gRef,jy0,shift,why] of rows){
    const label=`15° (${u},${v}) ${why}`
    const ray=api.trace(u,v,15)
    assert.equal(ray.terminal,'disk',`${label} 必须命中盘`)
    close(ray.radius,rRef,A1_RADIUS,`${label} 事件半径`)
    close(ray.g,gRef,A1_SHIFT,`${label} 原始 g`)
    close(ray.g4,Math.pow(gRef,4),A1_SHIFT,`${label} g⁴ 由独立参考 gRef 的四次方给出`)
    const c=a1Conserved(15,u,v)
    close(c.jy0,jy0,1e-13,`${label} 独立 Jy0`)
    /* 同事件公式一致性：把生产给出的事件半径代进独立闭式（μ 只由守恒量给），差 ≤1e-12。
       它验「公式在同一个事件上算对了」，不含轨迹误差 —— 同事件代数重排不是第二套标架。 */
    close(ray.g,a1Closed(ray.radius,a1Mu(ray.radius,jy0,c.E0)),A1_SAME,`${label} 同事件闭式`)
    close(ray.axialB,jy0/c.E0,A1_SAME,`${label} 有符号 Jy0/E0`)
    assert.equal(Math.sign(ray.axialB),Math.sign(jy0),`${label} 轴向符号必须与 Jy0 同号`)
    if(shift==='red')assert.ok(ray.g<1,`${label} 应当红移（g<1），实际 ${ray.g}`)
    if(shift==='blue')assert.ok(ray.g>1,`${label} 应当蓝移（g>1），实际 ${ray.g}`)
    if(shift==='zero'){
      assert.equal(ray.axialB,0,`${label} 零轴向必须精确为 0，否则闭式无从退化`)
      close(ray.g,Math.sqrt(1-3/ray.radius)/Math.sqrt(1-2/60),A1_SAME,`${label} 零轴向闭式`)
    }
  }
})
test('A1 支持角度边界 10°/50°：原始 g 与有符号轴向在两端都对得上独立参考',()=>{
  const {api}=fixture(a1Source(source))
  const rows=[
    /* [angle, u, v, 参考半径(dt=.01), 参考 g(dt=.01), 独立 Jy0, 频移] */
    [10,.20,.50,10.362822265496044,0.94151771647381066,2.982200098786643,'red'],
    [10,.15,.434,7.0024328474764070,0.87484027993176938,2.2423077701838152,'red'],
    [10,0,.635,15.832144807499851,0.91567504320274884,0,'zero'],
    [50,-.20,.70,11.153776851362885,0.82672402612360441,-1.9317867356770091,'red'],
    [50,0,.929,15.984112931370543,0.91669212578945658,0,'zero']
  ]
  for(const [angle,u,v,rRef,gRef,jy0,shift] of rows){
    const label=`${angle}° (${u},${v})`
    const ray=api.trace(u,v,angle)
    assert.equal(ray.terminal,'disk',`${label} 必须命中盘`)
    close(ray.radius,rRef,A1_RADIUS,`${label} 事件半径`)
    close(ray.g,gRef,A1_SHIFT,`${label} 原始 g`)
    close(ray.g4,Math.pow(gRef,4),A1_SHIFT,`${label} g⁴ 由独立参考 gRef 的四次方给出`)
    const c=a1Conserved(angle,u,v)
    close(c.jy0,jy0,1e-13,`${label} 独立 Jy0`)
    close(ray.g,a1Closed(ray.radius,a1Mu(ray.radius,jy0,c.E0)),A1_SAME,`${label} 同事件闭式`)
    close(ray.axialB,jy0/c.E0,A1_SAME,`${label} 有符号 Jy0/E0`)
    assert.equal(Math.sign(ray.axialB),Math.sign(jy0),`${label} 轴向符号必须与 Jy0 同号`)
    if(shift==='zero'){
      assert.equal(ray.axialB,0,`${label} 零轴向必须精确为 0`)
      close(ray.g,Math.sqrt(1-3/ray.radius)/Math.sqrt(1-2/60),A1_SAME,`${label} 零轴向闭式`)
    }else assert.ok(ray.g<1,`${label} 应当红移（g<1）`)
  }
})
test('A1 带符号理想切向事件：μ=±1 两侧的 g⁴ 同时越过旧限幅两端，只有原始 g 能验；它不代表当前相机射线',()=>{
  /* 合成事件：r=6、μ=±1、Jy0=±6^1.5/2。它不对应任何一条当前相机实际发射的射线（相机在
     60M 外，实际命中半径从 6.05M 起），只把解析值钉到生产公式上，并证明旧契约「从限幅 boost
     逆推 g」在这里必然失真：两侧 boost 分别被 1.7 与 0.4 截断，而 g⁴ 相差 81 倍。 */
  const {api}=fixture(a1Source(source))
  const ax=Math.pow(6,1.5)/2
  close(ax,7.3484692283495345,1e-13,'理想事件 Jy0')
  const pro=api.diskHit(6,0,0,0,0,ax)
  const ret=api.diskHit(6,0,0,0,0,-ax)
  close(pro.g,1.4383899044561526,A1_SAME,'理想顺行 μ=+1 的 g')
  close(ret.g,0.47946330148538424,A1_SAME,'理想逆行 μ=-1 的 g')
  close(pro.g,a1Closed(6,1),A1_SAME,'闭式 μ=+1')
  close(ret.g,a1Closed(6,-1),A1_SAME,'闭式 μ=-1')
  close(pro.g4,4.2806183115338898,A1_SAME,'理想顺行 μ=+1 的 g⁴')
  close(ret.g4,0.052847139648566563,A1_SAME,'理想逆行 μ=-1 的 g⁴')
  close(pro.g4,Math.pow(pro.g,4),A1_SAME,'g⁴=g·g·g·g（顺行）')
  close(ret.g4,Math.pow(ret.g,4),A1_SAME,'g⁴=g·g·g·g（逆行）')
  /* 旧契约在这里把权重截成 1.7 / 0.4；新契约只有 g⁴，两端都必须越界，三次方差全部保留。 */
  assert.ok(pro.g4>1.7,`顺行 g⁴ ${pro.g4} 必须越过旧上限 1.7`)
  assert.ok(ret.g4<0.4,`逆行 g⁴ ${ret.g4} 必须低于旧下限 0.4`)
  assert.ok(Math.abs(pro.g4-ret.g4)>1,
    '两侧 g⁴ 差必须保留（旧限幅只差 1.3，掩盖了 3 倍 g 差）')
})

/* ================= 第二十九阶段：g⁴ 发射权重接入真实渲染路径 =================
   旧契约把命中记录的权重写成 clamp(g^1.8,.4,1.7)，shade 里乘 ray.boost。新契约只存未夹限的
   g⁴，shade 的盘发射项乘 ray.g4，曝光仍是 3.2 × brightness，色调映射仍是 1−exp(−flux·b)。
   下面的断言全部走生产 trace / diskHit / shade，不另写一套盘模型：
     · g⁴ 等于 g 的四次幂，且不受 0.4…1.7 夹限；
     · 物理盘项对 g⁴ 成比例、对 S 线性、S=0 时精确为零；
     · 反演只在色调映射之前做，不要求映射后仍线性，也不拿整幅画面当零；
     · 旧新两版几何字段逐位相同；
     · 注入 g³ 或夹限权重，真实断言必须抛错。 */
const OLD_WEIGHT_CALC='var g4 = Math.min(1.7, Math.max(.4, Math.pow(g, 1.8)))'
const OLD_WEIGHT_FIELD='boost: g4,'
const CLAMPED_G4='var g4 = Math.min(1.7, Math.max(.4, g * g * g * g))'
const NEW_SHADE_TERM='breathe * ray.g4 * 3.2'
const OLD_SHADE_TERM='breathe * ray.boost * 3.2'
/* 只把「权重定义 + 字段名 + 发射项」还原成第二十八阶段的旧契约；相机、积分器、事件定位
   一个字都不动，所以两边任何几何字段的差异都只能来自本阶段改的那两处。 */
function legacySource(src){
  assert.equal(src.split(A1_G4_CALC).length,2,'g⁴ 计算行必须唯一')
  assert.equal(src.split(A1_G4_LINE).length,2,'g⁴ 字段行必须唯一')
  assert.equal(src.split(NEW_SHADE_TERM).length,2,'shade 发射项必须唯一')
  const out=src.replace(A1_G4_CALC,OLD_WEIGHT_CALC)
    .replace(A1_G4_LINE,OLD_WEIGHT_FIELD)
    .replace(NEW_SHADE_TERM,OLD_SHADE_TERM)
  assert.notEqual(out,src,'旧契约还原必须真的改到源码')
  return out
}
/* 从生产 shade 反演物理盘项本身：value = 1−exp(−flux·brightness) ⇒ flux = −ln(1−value)/b。
   这是读生产返回值，不是另写一套盘模型；线性与比例断言只在映射之前做。 */
function diskFlux(api,ray,time,brightness){
  const value=api.shade(ray,time,brightness)
  assert.ok(value>=0&&value<1,`shade 必须落在 [0,1)：${value}`)
  return -Math.log(1-value)/brightness
}
test('真实命中记录的 g⁴：等于 g 的四次幂，且不受 0.4…1.7 夹限',()=>{
  const {api}=fixture(a1Source(source))
  const rows=[[.51,.14,15],[-.66,.14,15],[.30,-.12,15],[0,.3415,15],[-.11,.66,15],[-.32,.12,15]]
  for(const [u,v,angle] of rows){
    const ray=api.trace(u,v,angle),label=`(${u},${v},${angle}°)`
    assert.equal(ray.terminal,'disk',`${label} 必须命中盘`)
    assert.ok(Number.isFinite(ray.g4)&&ray.g4>0,`${label} g⁴ 必须是有限正数`)
    close(ray.g4,Math.pow(ray.g,4),A1_SAME,`${label} g⁴=g 的四次幂（同事件代数）`)
  }
  /* 两个方向的越界样本：顺行 g⁴=4.28 > 1.7、逆行 g⁴=0.0528 < 0.4。若夹限还在，
     这两条都会落到边界值上。 */
  const ax=Math.pow(6,1.5)/2
  const pro=api.diskHit(6,0,0,0,0,ax),ret=api.diskHit(6,0,0,0,0,-ax)
  assert.ok(pro.g4>1.7&&ret.g4<0.4,'g⁴ 必须可以越过旧夹限两端')
  assert.ok(pro.g4!==1.7&&ret.g4!==0.4,'权重不许停在夹限值上')
})
test('生产 shade 的物理盘项：零 S 为零、对 g⁴ 成比例（S 固定），不靠整幅画面为零',()=>{
  const {api}=fixture()
  const hit=api.trace(.51,.14,15)
  assert.equal(hit.terminal,'disk')
  const time=1.7,brightness=.15
  /* 零 S：盘缘收口函数在 r ≤ INNER−0.2 与 r ≥ 16.2 上精确为 0，与 g⁴ 无关。
     这里只断言一条射线的物理盘项为零，不要求含艺术环的整幅画面为零。 */
  for(const radius of [5.5,17]){
    const value=api.shade({radius,phi:hit.phi,g4:hit.g4},time,brightness)
    assert.equal(value,0,`S=0（r=${radius}）时盘发射必须精确为 0，实际 ${value}`)
  }
  /* g⁴=0 也没有发射：零频移权重不是「一条暗射线」，而是精确的 0。 */
  assert.equal(api.shade({radius:hit.radius,phi:hit.phi,g4:0},time,brightness),0)
  const unit=diskFlux(api,{radius:hit.radius,phi:hit.phi,g4:1},time,brightness)
  const triple=diskFlux(api,{radius:hit.radius,phi:hit.phi,g4:3},time,brightness)
  assert.ok(unit>0,'权重取 1 时物理盘项必须为正')
  assert.ok(Math.abs(triple/unit-3)<1e-9,`盘项对 g⁴ 线性失败：flux(3)/flux(1)=${triple/unit}`)
  /* 真实命中记录：反演出来的盘项必须正好是「同一几何、权重取 1」的 g⁴ 倍。 */
  const real=diskFlux(api,hit,time,brightness)
  assert.ok(Math.abs(real/unit-hit.g4)<1e-9*Math.max(1,hit.g4),
    `真实命中记录的 flux/unit=${real/unit}，g⁴=${hit.g4}`)
  /* 曝光仍是乘性一次项：brightness 只乘在 flux 上，所以 ln(1−v) 与 brightness 成正比。 */
  const v1=api.shade(hit,time,.15),v2=api.shade(hit,time,.3)
  assert.ok(Math.abs(Math.log(1-v2)-2*Math.log(1-v1))<1e-9,
    'brightness 必须只以乘性一次项进入物理盘项')
  /* 色调映射没被换掉：映射后并不线性（差值正好是 v₁²），这里只证明我们没有要求它线性。 */
  const dbl=api.shade({radius:hit.radius,phi:hit.phi,g4:hit.g4*2},time,.15)
  assert.ok(Math.abs(2*v1-dbl)>1e-3,'1−exp(−flux·b) 仍是非线性映射，不得被替换成线性')
})
/* 阶段29 收尾：真实 S 的乘性回归。上面那条用例固定 S、只改 g⁴，证明不了「对 S 线性」——
   把生产盘项改成 S²·g⁴，它照样通过。这里只通过 VM 内存钩子给真实 S 加一个乘性因子 c，
   射线、r、phi、time、g⁴、brightness 全部不动，再反演映射前的盘项看它是否随 c 线性。 */
function scaledSource(src,c){
  /* 锚只要求「盘发射项仍是 <S> * ray.g4 * 3.2」这一形状，不锁死 S 的文本：
     S 被改成 S² 时锚仍然匹配，失败只能来自线性断言本身。 */
  const anchor=/flux \+= ([^\n]*?) \* ray\.g4 \* 3\.2/
  assert.match(src,anchor,'生产 shade 的盘发射项必须仍是 <S> * ray.g4 * 3.2')
  return src.replace(anchor,(all,terms)=>`flux += (${c}) * (${terms}) * ray.g4 * 3.2`)
}
function assertSLinear(src){
  const one=scaledSource(src,1),two=scaledSource(src,2)
  /* 两次装配除了那个 c 字面量必须逐字相同：钩子没有别的副作用。 */
  assert.equal(two.replace('flux += (2) * (','flux += (1) * ('),one,'c 只能是插进 S 的那一个乘性因子')
  /* c 必须落在 S 上，不能落在 g⁴ 或曝光上：两者仍在括号外、出现次数不变。 */
  assert.equal((one.match(/ray\.g4/g)||[]).length,(src.match(/ray\.g4/g)||[]).length,'钩子不得改动 g⁴')
  assert.ok(/\) \* ray\.g4 \* 3\.2/.test(one),'c 必须乘在 S 上，不能改写 g⁴ 或 3.2 曝光')
  const a=fixture(one),b=fixture(two)
  const ray=a.api.trace(.51,.14,15)
  assert.equal(ray.terminal,'disk')
  assert.ok(ray.radius>=6&&ray.radius<=20,`命中半径 ${ray.radius} 必须落在盘内`)
  const time=1.7,brightness=.15
  const d1=diskFlux(a.api,ray,time,brightness)
  const d2=diskFlux(b.api,ray,time,brightness)
  assert.ok(d1>1e-6,`c=1 的映射前盘项必须为正：${d1}`)
  close(d2,2*d1,1e-9*Math.max(1,d2),'c=2 的盘项必须是 c=1 的两倍（对 S 线性）')
}
test('真实 S 的乘性因子 c=1/2：盘项在色调映射前对 S 线性，只缩放 S 不动 g⁴ 与 brightness',()=>{
  assertSLinear(source)
  /* 同一几何、同一 g⁴：固定射线在两档装配里必须是同一条记录。 */
  const a=fixture(scaledSource(source,1)).api,b=fixture(scaledSource(source,2)).api
  const ra=a.trace(.51,.14,15),rb=b.trace(.51,.14,15)
  assert.equal(ra.radius,rb.radius);assert.equal(ra.phi,rb.phi);assert.equal(ra.g4,rb.g4)
})
test('S² 故障被真实断言抓住：生产盘项改成 S²·g⁴ 时，失败来自线性断言而不是锚或语法',()=>{
  /* 变异只在盘项后加一行，S 的表达式文本一字不动 —— 装配锚照样匹配、也没有语法错误，
     所以只要失败，就只能来自「对 S 线性」那条断言。 */
  const squared=source.replace(/(flux \+= [^\n]*\n)/,'$1      flux = flux * flux / (ray.g4 * 3.2)\n')
  assert.notEqual(squared,source,'盘发射项必须还认得出')
  assert.throws(()=>assertSLinear(squared),/两倍（对 S 线性）/)
})
test('旧新几何逐位一致：只有权重字段换了名字与定义，半径/方位角/环权重/终态/步数全同',()=>{
  const fresh=fixture(),legacy=fixture(legacySource(source))
  const geom=r=>({radius:r.radius,phi:r.phi,ring:r.ring,impact:r.impact,captured:r.captured,terminal:r.terminal,steps:r.steps})
  const samples=[[0,0,15],[0,.34125,15],[.51,.14,15],[-.11,.66,15],[0,.8,15],[.3,-.12,10]]
  for(const [u,v,angle] of samples){
    assert.deepEqual(geom(fresh.api.trace(u,v,angle)),geom(legacy.api.trace(u,v,angle)),
      `(${u},${v},${angle}°) 的原几何字段必须逐位相同`)
  }
  /* 权重本身当然不同：旧版是 clamp(g^1.8,.4,1.7)，新版是 g⁴。这条证明上面的「全同」
     不是因为两边都没算。 */
  const a=fresh.api.trace(.51,.14,15),b=legacy.api.trace(.51,.14,15)
  assert.ok(Math.abs(a.g4-b.boost)>1e-3,'新 g⁴ 与旧 boost 必须真的不同')
})
function assertG4Contract(api){
  const ray=api.trace(.51,.14,15)
  assert.equal(ray.terminal,'disk')
  assert.ok(ray.g4>1.7,`g⁴ ${ray.g4} 必须越过旧上限 1.7，否则夹限可能还在`)
  close(ray.g4,Math.pow(ray.g,4),A1_SAME,'g⁴ 与 g 的四次幂关系')
  const pro=api.diskHit(6,0,0,0,0,Math.pow(6,1.5)/2)
  assert.ok(pro.g4>1.7,`理想顺行 g⁴ ${pro.g4} 必须越过旧上限 1.7`)
  close(pro.g4,Math.pow(a1Closed(6,1),4),A1_SAME,'理想顺行事件 g⁴')
  return ray
}
/* 改前 shade 的独立参考：内联常量、照抄原公式，不读生产模块里的任何标识符 ——
   期望值只来自这份文本，不能让实现给自己出题。 */
function shadeReference(ray,time,brightness,spin){
  const INNER=6
  const KNOTS=[{ n: 1, radial: 1.9, angular: 1.0, weight: .16 },
    { n: 2, radial: 2.7, angular: -.62, weight: .11 }]
  const smooth=(lo,hi,x)=>{const t=Math.min(1,Math.max(0,(x-lo)/(hi-lo)));return t*t*(3-2*t)}
  const flux=0
  const turn=time*(Number(spin)||0)
  if(ray.radius){
    const r=ray.radius
    const phase=ray.phi-turn-time*(1.2+16/Math.pow(r,1.5))
    const arms=.72+.28*Math.sin(2*phase-4*Math.log(r/INNER))
    const band=.82+.18*Math.sin(r*1.1+1.6*Math.sin(2*phase))
    let knots=0
    for(let i=0;i<KNOTS.length;i++){
      const knot=KNOTS[i]
      knots+=knot.weight*Math.sin(knot.n*phase+knot.radial*Math.log(r/INNER)-time*knot.angular)
    }
    const breathe=1+.03*Math.sin(time*.33)
    const edge=smooth(INNER-.2,INNER+.8,r)*(1-smooth(14.5,16.2,r))
    return 1-Math.exp(-(edge*Math.pow(INNER/r,2)*arms*(band+knots)*breathe*ray.g4*3.2)*brightness)
  }
  return 0
}
test('shade 局部去重后与改前独立参考逐位相同：log 只算一次，公式与乘加顺序不变',()=>{
  const {api}=fixture()
  /* 有效着色分支里只留一处 Math.log(r / INNER)，KNOTS 循环不再各算一遍。 */
  assert.equal(source.split('Math.log(r / INNER)').length,2,'shade 里的 Math.log(r / INNER) 必须恰好一处')
  assert.ok(source.includes('var logR = Math.log(r / INNER)'),'logR 局部变量必须还在')
  const rays=[]
  /* 半径边界：盘两侧收口、呼吸区、外缘。相位/时间/自旋/g⁴/亮度在下面逐条组合。 */
  for(const radius of [2,5.5,5.999,6,6.3,7,9.11,11.7,14.49,14.5,15.2,16.21,20]) {
    for(const phi of [-3.1,-.7,0,.35,1.9,3.05]) {
      for(const g4 of [.06,.4,1,3.55]) rays.push({radius,phi,g4})
    }
  }
  /* 真实命中记录也进样本：半径与相位不是人造的。 */
  for(const [u,v,angle] of [[.51,.14,15],[0,.34125,15],[-.11,.66,15],[.3,-.12,10],[0,.8,50]]){
    const hit=api.trace(u,v,angle)
    if(hit.radius) rays.push(hit)
  }
  let comparisons=0
  for(const ray of rays){
    for(const time of [0,.37,1.7,3.9,11.25]){
      for(const brightness of [.15,.5,1,2]){
        for(const spin of [undefined,0,.42]){
          const actual=api.shade(ray,time,brightness,spin)
          const expected=shadeReference(ray,time,brightness,spin)
          assert.ok(Object.is(actual,expected),`shade(${ray.radius},${ray.phi},g⁴=${ray.g4},t=${time},b=${brightness},spin=${spin})=${actual}，参考 ${expected}`)
          comparisons++
        }
      }
    }
  }
  assert.ok(comparisons>5000,`样本量 ${comparisons} 太小`)
  /* 没有半径的射线仍精确为 0：不触发任何着色分支。 */
  assert.equal(api.shade({phi:1,g4:1},1,1),0)
})
test('有效着色分支的 Math.log 只计一次：隔离 VM 计数，宿主 Math 不动',()=>{
  /* 计数对象是本 VM 内部的替身：它以 vm 自己的内在 %Math% 为原型，只覆盖 log，不改宿主 Math，
     也不碰任何原型链。每次 fixture() 都新建一个，互不串号。 */
  const hostLog=Math.log
  const probe=fixture()
  let calls=0
  const sink=vm.runInContext('Math',probe.context)
  const proxy=Object.create(sink)
  proxy.log=v=>{calls++;return sink.log(v)}
  probe.context.Math=proxy
  const reset=()=>{calls=0}
  const ray={radius:9.5,phi:.42,g4:1.3}
  reset()
  const once=probe.api.shade(ray,1.7,1,.42)
  /* 旋臂一次 + 两个亮度团各一次，旧实现是三次；去重后只该剩一次。 */
  assert.equal(calls,1,`有效着色分支调用了 ${calls} 次 Math.log`)
  assert.equal(once,shadeReference(ray,1.7,1,.42),'计数用例里的值也必须与参考一致')
  /* 无半径分支一次都不调。 */
  reset()
  probe.api.shade({phi:.42,g4:1.3},1.7,1,.42)
  assert.equal(calls,0,'没有半径的射线不该进入着色分支')
  /* 第二次有效着色：每一帧每一步仍然只算一次，不会因计数替身被缓存而漏算。 */
  reset()
  probe.api.shade(ray,2.2,.15)
  assert.equal(calls,1,'第二次有效着色也必须只算一次')
  /* 宿主 Math 与 vm 内在 Math 都没被替换：替身只换掉了那个上下文的 Math 绑定。 */
  assert.equal(Math.log,hostLog,'宿主 Math.log 被改动了')
  const shadow=fixture()
  assert.equal(vm.runInContext('Math.log(1)===0&&Math.log!==undefined',shadow.context),true)
})
test('g⁴ 契约的负向注入：g³ 与夹限权重都被真实断言抓住（生产源被改就会非零退出）',()=>{
  /* 生产源里不许再出现 boost 权重字段或 ray.boost 读取：没有兼容层，也没有死字段。 */
  assert.ok(!/ray\.boost/.test(source),'生产源不许再读 ray.boost')
  assert.ok(!/\bboost\s*:/.test(source),'命中记录不许再保留 boost 字段')
  assert.ok(assertG4Contract(fixture(a1Source(source)).api).g4>1.7,'正向样本必须先通过')
  /* 注入 g³：命中记录写成 g·g·g。 */
  const g3=source.replace(A1_G4_CALC,'var g4 = g * g * g')
  assert.notEqual(g3,source,'g⁴ 计算行必须还认得出')
  assert.throws(()=>assertG4Contract(fixture(a1Source(g3)).api),/四次幂关系/)
  /* 注入夹限：把旧的 [0.4,1.7] 套回 g⁴。 */
  const clamped=source.replace(A1_G4_CALC,CLAMPED_G4)
  assert.notEqual(clamped,source)
  assert.throws(()=>assertG4Contract(fixture(a1Source(clamped)).api),/越过旧上限 1\.7/)
})

/* 计数只插在测试 VM 里：格子几何的调用点换成先记账再调原函数，Math.sqrt/atan2 也在源码里换成
   计数包装（见 countedSource）。两边合起来才说明「已访问格子的静态几何」真的少算了。 */
function countedSource(src){
  const patched=src.replace(/var g0 = geomFor\(/, 'var g0 = (function () { geoHits++; return geomFor.apply(null, arguments) }).call(null, ')
    .replace(/function geomFor\(cache, cols, i, cw, ch, baseX, baseY\) \{/, 'var geoHits = 0\n  function geomFor(cache, cols, i, cw, ch, baseX, baseY) {')
    /* VM 的 %Math% 是内建对象，宿主侧拿到的是副本，从外面替换 context.Math 拦不住模块里已经
       闭包住的 Math 绑定。所以几何计数只替换源码里的调用点，被调用的仍是内建函数本身，
       返回值逐位相同，宿主 Math 与 VM 内在 Math 都不变。 */
    .replace(/Math\.sqrt\(/g, '__sqrt(')
    .replace(/Math\.atan2\(/g, '__atan2(')
    /* 生产源码是 \r\n：/m 的 ^ 只认 \n 之前的位置，锚不住缩进，所以这里按「缩进 + 换行」定位。 */
    .replace(/  var geoHits = 0\r?\n/g, '  var geoHits = 0, sqrtCalls = 0, atanCalls = 0\n  function __sqrt(v) { sqrtCalls++; return Math.sqrt(v) }\n  function __atan2(y, x) { atanCalls++; return Math.atan2(y, x) }\n  globalThis.__geoCount = { sqrt: function () { return sqrtCalls }, atan: function () { return atanCalls } }\n')
    .replace(/(debugSource: 'v3')/, "$1, geoHits: function () { return geoHits }")
  assert.notEqual(patched,src,'几何计数插桩必须命中 geomFor 与对外接口')
  assert.ok(patched.includes('return geoHits'),'几何计数插桩必须挂到对外接口上')
  assert.ok(patched.includes('__geoCount'),'几何计数插桩必须把计数函数交出来')
  return patched
}
test('静态几何缓存：同一生产绘制器分别走参考几何与缓存几何，逐帧的字符、位置、maxWidth、颜色与顺序全同',()=>{
  /* 参考路径不缓存，也不复制渲染器：测试 VM 里只把 geomFor 换成一份「每次都按生产原式现算」的
     独立表达式（基准来自改动前的 draw()），再跑同一个 create()/draw()。字符、顺序、位置、
     maxWidth、fillStyle 与绘制调用顺序逐帧严格比较，不比较调用次数。 */
  const reference=`function geomFor(cache, cols, i, cw, ch, baseX, baseY) {
  /* 改动前 draw() 里那三行的原样：坐标、平方半径、按需开方、按需扇区。 */
  var gx0 = (i % cols + .5) * cw - baseX
  var gy0 = (((i / cols) | 0) + .5) * ch - baseY
  var gd2 = gx0 * gx0 + gy0 * gy0
  var exact = 0, d = 0, bin = 0
  return { get: function (k) {
    if (k === 0) return gx0
    if (k === 1) return gy0
    if (k === 2) return gd2
    if (k === 3) return exact ? d : (exact = 1, d = Math.sqrt(gd2))
    if (k === 4) return bin >= 0 ? bin : (bin = (((Math.atan2(gy0, gx0) + Math.PI) / (Math.PI * 2) * RING_BINS) | 0) % RING_BINS)
    return 0
  }, set: function (k, v) { if (k === 3) d = v; else if (k === 4) bin = v } }
}`
  const patchedSource=source.replace(/function geomFor\(cache, cols, i, cw, ch, baseX, baseY\) \{[\s\S]*?\n  \}\r?\n/,reference+'\n')
  const countedCache=countedSource(source)
  assert.notEqual(patchedSource,source,'参考几何的替换必须真的命中 geomFor，否则两边跑的是同一套实现')
  function build(name){
    /* VM 里被全局替换的 Math 未必能穿透到模块闭包，所以覆盖范围的判据是下面逐帧比较的
       Canvas 调用序列，不指望在这里数调用次数。 */
    const f=fixture(name==='cache'?source:patchedSource,{width:160,height:100},{canvas2d:true})
    const calls=[]
    const ctx=f.canvas.getContext()
    for(const key of ['fillText','fill','drawImage','arc','clearRect','beginPath','save','restore'])
      if(typeof ctx[key]==='function'){
        const orig=ctx[key]
        ctx[key]=function(){calls.push({op:key,args:[].slice.call(arguments).map(v=>typeof v==='object'&&v?`<${v.width}x${v.height}>`:v),fillStyle:String(ctx.fillStyle),font:String(ctx.font),textAlign:String(ctx.textAlign),textBaseline:String(ctx.textBaseline),globalAlpha:ctx.globalAlpha});return orig.apply(ctx,arguments)}
      }
    const props=()=>({fillStyle:String(ctx.fillStyle),font:ctx.font,align:ctx.textAlign,baseline:ctx.textBaseline,alpha:ctx.globalAlpha})
    const r=f.api.create(f.canvas)
    f.drain()
    f.ticks=0
    function tick(){
      f.frame((f.ticks+=40))
      return {calls:calls.splice(0,calls.length),state:props()}
    }
    return {f,r,tick,props}
  }
  const ref=build('ref'),cur=build('cache')
  assert.equal(ref.r.stats().ready,true);assert.equal(cur.r.stats().ready,true)
  let frames=0,glyphs=0
  function same(where){
    const a=ref.tick(),b=cur.tick()
    assert.deepEqual(b.calls,a.calls,`${where}: 这一帧的 Canvas 调用序列必须逐项相同`)
    assert.deepEqual(cur.props(),ref.props(),`${where}: 帧末的绘制状态（含 fillStyle）必须相同`)
    frames++
    for(const c of b.calls)if(c.op==='fillText')glyphs++
  }
  same('冷缓存首帧（暗档）')
  same('暖缓存第二帧')
  same('暖缓存第三帧')
  /* 只改动态参数：时间、亮度、转速、浓淡都不该动静态几何。 */
  cur.r.setAlpha(.35);ref.r.setAlpha(.35);same('暖缓存 + globalAlpha')
  cur.r.update({brightness:.4});ref.r.update({brightness:.4});same('暖缓存 + 亮度变化')
  cur.r.pose({speed:1.4});ref.r.pose({speed:1.4});same('暖缓存 + 转速变化')
  /* 明暗档：只换墨色与影色。 */
  ref.r.setMode('light');cur.r.setMode('light');same('亮档')
  /* 非整数取景位移：baseX/baseY 逐位变，缓存按键失效并重算。 */
  cur.r.pose({viewX:37.25,viewY:-11.5});ref.r.pose({viewX:37.25,viewY:-11.5});same('非整数取景位移')
  same('非整数位移的暖帧')
  cur.r.pose({viewX:-13.75,viewY:6.25});ref.r.pose({viewX:-13.75,viewY:6.25});same('负的非整数位移')
  cur.r.update({ringProjection:.8});ref.r.update({ringProjection:.8});same('环投影范围缩放')
  same('环投影缩放后的暖帧')
  /* 尺寸变化后重建。 */
  ref.f.box.width=241;cur.f.box.width=241
  ref.r.resize();cur.r.resize();ref.f.drain();cur.f.drain();same('尺寸变化（含重建网格）')
  same('尺寸变化后的暖帧')
  /* 网格参数变化：仰角换重建，格子宽度换重分列。 */
  ref.r.update({angle:22});cur.r.update({angle:22});ref.f.drain();cur.f.drain();same('仰角变化')
  ref.r.update({cellWidth:7});cur.r.update({cellWidth:7});ref.f.drain();cur.f.drain();same('格子宽度变化')
  same('格子宽度变化后的暖帧')
  /* 环包络原地变化：直接改 stats 里那张 edge，不碰对象身份。 */
  const edge=ref.r.stats().ring.edge
  assert.ok(edge instanceof Float32Array,'这条用例需要环层就绪，否则测不到包络比较')
  for(let i=0;i<edge.length;i++)edge[i]=i%7===0?0:400
  same('环包络原地变化')
  /* 环不可用：没有 createElement 就没有环层，纯 ASCII 路径也必须逐帧相同。 */
  const noref=fixture(source,{width:160,height:100})
  const nocur=fixture(patchedSource,{width:160,height:100})
  const nr=noref.api.create(noref.canvas),nc=nocur.api.create(nocur.canvas)
  noref.drain();nocur.drain()
  assert.equal(nr.stats().ring.state,'unavailable');assert.equal(nc.stats().ring.state,'unavailable')
  assert.deepEqual(nocur.placed,noref.placed,'环不可用时的 ASCII 落字也必须逐字相同')
  assert.ok(noref.placed.length>50,'无环路径几乎没有落字，比不出来')
  cur.r.dispose();ref.r.dispose()
  assert.ok(frames>=15,`只比了 ${frames} 帧`)
  assert.ok(glyphs>200,`字符样本 ${glyphs} 太少`)
})
test('静态几何缓存：隔离 VM 计数证明暖缓存不再重复算已访问格子的几何，失效后重算，改动态参数不误失效',()=>{
  /* 计数只用 VM 内的替换：一次进格子几何记一次访问（countedSource 在调用点插桩），
     Math.sqrt / Math.atan2 数的是整个 draw（构建在 create 里已经跑完，所以帧内数到的就是绘制）。
     不要求「整个 draw 的 sqrt 为零」——盘面每帧本来就有一枚清屏用的 sqrt，不在格子几何分支里。
     尺寸取 640×360：环的方位包络 edgeMax 约 64px，大于 short/2，环外确有盘格落在环带里，
     所以「阴影圆外、环带内」这一支与扇区桶在固定输入下真的会被走到（160×100 时环整圈落在盘外）。 */
  const f=fixture(countedSource(source),{width:640,height:360},{canvas2d:true})
  /* create() 返回的控制器只有公开方法：几何访问口挂在模块的 api 上，Math 计数口挂在 VM 全局上。
     不挂到 api 上是因为 geoSrc 只替换过一次 api 尾行，替换表必须逐条命中。 */
  const geoHits=f.api.geoHits
  const sqrtCalls=f.context.__geoCount.sqrt, atanCalls=f.context.__geoCount.atan
  const r=f.api.create(f.canvas)
  f.drain()
  assert.ok(r.stats().cells>0)
  assert.equal(r.stats().ring.state,'ready','环层必须就绪，否则环带分支根本不进')
  function frame(n){
    const g0=geoHits(),s0=sqrtCalls(),a0=atanCalls()
    f.frame(n)
    return {sqrt:sqrtCalls()-s0,atan:atanCalls()-a0,geo:geoHits()-g0}
  }
  /* 冷缓存首帧：被环区粗筛命中的格子要开方，说明这一帧几何真的算过。
     不在这里要求 atan>0：构建期那次同步 draw（finishBuild → sync）已经把环带格的扇区桶算好，
     首帧读到的都是缓存值。 */
  const cold=frame(40)
  assert.ok(cold.geo>0,'冷缓存首帧必须有格子几何访问')
  assert.ok(cold.sqrt>0,'冷缓存首帧的绘制阶段必须有几何开方')
  assert.equal(cold.atan,0,'构建期已把环带扇区桶算完，冷首帧不该再算 atan2')
  const outer=cold.geo
  /* 暖缓存：同一取景下每个被访问的格子都命中缓存，石头几何不再开方、不再算扇区。 */
  const warm=frame(80)
  assert.equal(warm.geo,outer,`暖缓存的格子几何访问应当与冷帧同一批，实际多了 ${warm.geo-outer} 次`)
  assert.equal(warm.atan,0,`暖缓存仍多算了 ${warm.atan} 次 Math.atan2`)
  /* 帧内剩的 sqrt 只有 ringClear = sqrt(cw²+ch²)/2+1 这一枚帧常量，不在格子几何分支里。 */
  assert.ok(warm.sqrt<=1,`暖缓存仍多算了 ${warm.sqrt} 次 Math.sqrt（只允许 ringClear 那一枚）`)
  /* 只改动态参数：不算失效。 */
  r.update({brightness:.5});r.pose({speed:1.2});r.setAlpha(.5)
  assert.ok(frame(120).sqrt<=1,'只改时间/亮度/转速/浓淡不该让几何缓存失效')
  assert.equal(frame(130).atan,0)
  /* 取景位移不改 baseX/baseY（两相抵消，恒等于 w/2、h/2，与原式一致）：缓存照旧命中，
     位移由 setTransform 每帧施加，绘制结果由下面那条差分用例逐帧核对。 */
  r.pose({viewX:21.5,viewY:4.25})
  const moved=frame(160)
  assert.ok(moved.geo>0,'取景位移后仍要走格子几何')
  assert.ok(moved.sqrt<=1,'取景位移不该清空几何缓存')
  assert.ok(frame(170).sqrt<=1,'位移后的下一帧必须回到暖状态')
  /* 改格子宽度会重分列、整张网格重建：新格子从空缓存开始，扇区桶必须重算（这里才真正走到 atan2）。
     构建期那次同步 draw 已经把有机会进环带的格子访问过一遍，所以开方要看「缓存被清掉」本身：
     构建后总量必须明显高于上一份缓存的访问量。 */
  const before=sqrtCalls(), atanBefore=atanCalls()
  r.update({cellWidth:7});f.drain()
  const regrid=frame(190)
  assert.ok(regrid.geo>0,'网格参数变化后必须重建格子几何')
  assert.ok(sqrtCalls()>before+regrid.geo,'网格参数变化后必须重算开方（构建期新网格的几何是冷的）')
  assert.ok(atanCalls()>atanBefore,'网格参数变化后环带格的扇区桶必须重算（构建期那次同步 draw）')
  assert.ok(frame(200).sqrt<=1,'重建后的下一帧回到暖缓存')
  /* 环包络原地变化不会让几何缓存失效（缓存的是距离与扇区，不是让位结果）。 */
  const edge=r.stats().ring.edge
  for(let i=0;i<edge.length;i++)edge[i]=0
  frame(240)
  assert.ok(frame(280).sqrt<=1,'包络变化不该导致每帧重算')
  /* 同尺寸 resize 短路不该清缓存。 */
  r.resize()
  assert.ok(frame(320).sqrt<=1,'同尺寸 resize 短路不该无故清空几何缓存')
  assert.equal(frame(330).atan,0,'同尺寸 resize 短路后扇区桶仍该命中')
  /* 不同尺寸：重建网格 + 重算几何（重建期的同步 draw 就把新几何算冷了一遍）。 */
  const beforeSize=sqrtCalls()
  f.box.width=680
  r.resize();f.drain()
  assert.ok(frame(360).geo>0,'尺寸变化后必须重建格子几何')
  assert.ok(sqrtCalls()>beforeSize+772,'尺寸变化后必须重算几何')
  assert.ok(frame(370).sqrt<=1,'新尺寸的下一帧回到暖缓存')
  r.dispose()
})
test('静态几何缓存：失败与零尺寸都不保留旧缓存',()=>{
  /* 最终失败：耗尽注入下网格失败闭合，之后恢复预算重建必须从空缓存开始。
     测试里把失败那次的预算换成 4 步，再换回正常预算模拟「下一次 resize 重建」。 */
  const f=fixture(injectBudget(4),{width:160,height:100},{canvas2d:true})
  const r=f.api.create(f.canvas)
  f.drain()
  assert.equal(r.stats().ready,false)
  assert.equal(f.canvas.dataset.blackHoleState,'failed')
  assert.equal(f.painted.length,0,'失败态不落字')
  r.dispose()
  assert.equal(f.canvas.dataset.blackHoleState,'disposed')
  /* 再建一个正常实例：丢弃的不是缓存而是这一次的网格，新实例从冷缓存开始也一样画对。 */
  const ok=fixture(null,{width:160,height:100},{canvas2d:true})
  const r2=ok.api.create(ok.canvas)
  ok.drain()
  assert.equal(r2.stats().ready,true)
  assert.ok(ok.painted.length>0)
  /* 零尺寸：draw 直接返回，缓存释放；恢复尺寸后照常重建并画。 */
  ok.box.width=0
  r2.resize()
  ok.box.width=160
  r2.resize();ok.drain()
  assert.equal(r2.stats().ready,true)
  const before=ok.painted.length
  ok.frame(40)
  assert.ok(ok.painted.length>before,'零尺寸恢复后必须继续出字')
  r2.dispose()
})
