/* Run after geodesic.js and geodesic-gpu.js in an actual WebGL2 browser.
 * Owns a detached context only; never touches the mounted theme or credentials. */
var UniverseGPUCheck = async function (options) {
  options = options || {}
  var canvas = document.createElement('canvas')
  var gl = canvas.getContext('webgl2', { alpha: true, antialias: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: true })
  if (!gl) throw Error('Hardware WebGL2 unavailable')
  var gpu, report = { status: 'running', cases: [], grids: [], environment: { userAgent: navigator.userAgent, visible: !document.hidden } }
  globalThis.__QUASAR_GPU_CHECK = report
  try {
    var debug = gl.getExtension('WEBGL_debug_renderer_info')
    report.environment.renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    var start = performance.now(); gpu = await UniverseGeodesicGPU.create(gl); report.compileMs = performance.now() - start
    var tests = [[15, 0, .341239, 'capture'], [15, 0, .34124], [15, 0, .34125, 'disk', 7.719197222378511, 1e-3], [15, 0, .3413, 'escape'], [15, .51, .14, 'disk', null, null, 2.5840910128766161]]
    var historical = [
      [-.152349377,.65408805,null,'escape'],[-.266611409,.352201258,null,'escape'],[.063478907,.339622642,null,'escape'],
      [-.177740939,.301886792,15.027047208931727,'disk'],[.330090316,.088050314,6.983314051369235,'disk'],
      [-.292002972,.176100629,null,'capture'],[-.025391563,.339622642,null,'capture'],[-.215828283,.264150943,null,'capture'],
      [-.292002972,-.176100629,9.61002970555677,'disk'],[-.215828283,-.264150943,12.69887628051936,'disk'],[-.025391563,-.339622642,15.133147461916979,'disk']]
    historical.forEach(function (row) { [row[0], -row[0]].forEach(function (u) { tests.push([15, u, row[1], row[3], row[2], 1e-5]) }) })
    ;[[.528636384,-.240963855,13.175659340],[.656790659,-.240963855,13.977014456],[.544655668,.120481928,7.575862640],[-.865041356,-.192771084,14.373862200],[.080096422,-.506024096,15.733862111],[-.160192844,.650602410,15.901028140],[0,.6506,15.002660760]].forEach(function (r) { tests.push([15, r[0], r[1], 'disk', r[2], 1e-5]) })
    ;[[10,0,.431,'escape'],[10,0,.434,'disk',6.1023668060835075],[10,0,.635,'disk',15.832144807501463],[10,0,.638,'escape'],[10,0,-.535,'disk',15.999054815567503],[10,0,.3411392425050419,'capture'],[10,0,.3413392425050419,'escape'],[50,0,.476,'escape'],[50,0,.479,'disk',6.046937605906586],[50,0,.929,'disk',15.98411293137068],[50,0,.932,'escape'],[50,0,.35,'disk',6.198176252312114],[50,0,.3411392424792922,'capture'],[50,0,.3413392424792922,'escape']].forEach(function (r) { r[5] = 1e-6; tests.push(r) })
    var names = ['', 'disk', 'capture', 'escape', 'exhausted', 'invalid']
    for (var a = 0; a < 3; a++) {
      var angle = [15, 10, 50][a], group = tests.filter(function (t) { return t[0] === angle })
      var result = await gpu.run({ angle: angle, rays: group.map(function (t) { return [t[1], t[2]] }), inspect: true })
      var precise = UniverseGPUCheck.sameEvent(gl, result.rawData)
      group.forEach(function (t, index) {
        var data = result.data, offset = index * 8, cpu = UniverseGeodesic.trace(t[1], t[2], angle), terminal = names[data[offset + 3]]
        var expected = t[3] || cpu.terminal, valid = terminal === expected
        if (t[4] != null) valid = valid && Math.abs(data[offset] - t[4]) <= t[5]
        if (t[6] != null) valid = valid && Math.abs(data[offset + 2] - t[6]) <= 1e-6
        for (var f = 0; f < 8; f++) valid = valid && Number.isFinite(data[offset + f])
        var same = null
        if (terminal === 'disk') {
          var n = index * 8, r = precise[n] + precise[n + 1], g = precise[n + 2] + precise[n + 3], g4 = precise[n + 4] + precise[n + 5], axial = precise[n + 6] + precise[n + 7]
          var sa = Math.sin(angle * Math.PI / 180), ca = Math.cos(angle * Math.PI / 180), tan = 3 * Math.sqrt(3) / 60 / .34
          var px = t[1] * tan, py = -sa + t[2] * tan * ca, pz = -ca - t[2] * tan * sa, length = Math.hypot(px, py, pz)
          px /= length; py /= length; pz /= length
          var jy = 60 * ca * px, jx = 60 * sa * pz - 60 * ca * py, jz = -60 * sa * px, energy = Math.sqrt(1 - 2 * (jx * jx + jy * jy + jz * jz) / Math.pow(60, 3))
          var mu = Math.sqrt(1 - 2 / r) * jy / (r * energy), closed = Math.sqrt(1 - 3 / r) / (Math.sqrt(1 - 2 / 60) * (1 - Math.sqrt(1 / (r - 2)) * mu))
          same = { gError: Math.abs(g - closed), axialError: Math.abs(axial - jy / energy), fourthPowerError: Math.abs(g4 - Math.pow(g, 4)) }
          same.passed = Number.isFinite(r + g + g4 + axial) && same.gError <= 1e-12 && same.axialError <= 1e-12 && same.fourthPowerError <= 1e-12
          valid = valid && same.passed
        }
        report.cases.push({ input: t.slice(0, 3), sameEvent: same, passed: valid, expected: expected, terminal: terminal, radius: data[offset], referenceRadius: t[4], radiusTolerance: t[5], g4: data[offset + 2], cpuRadius: cpu.radius, cpuG4: cpu.g4, steps: data[offset + 6], retried: data[offset + 7] })
      })
      result.dispose()
    }
    var exhausted = await gpu.run({ angle: 15, rays: [[0, .1]], budget: 4 })
    report.budgetGuard = exhausted.data[3] === 4 && exhausted.data[6] === 8 && exhausted.data[7] === 1
    exhausted.dispose()
    if (options.fullGrid) {
      var dims = options.dimensions || [[1200, 800], [2400, 1350]]
      for (var d = 0; d < dims.length; d++) {
        var w = dims[d][0], h = dims[d][1], cw = Math.max(6, Math.sqrt(w * h / 24000)), cols = Math.max(1, Math.floor(w / cw)); cw = w / cols
        var rows = Math.max(1, Math.floor(h / (cw * 1.5))), ch = h / rows
        var out = await gpu.run({ width: w, height: h, columns: cols, rows: rows, cellWidth: cw, cellHeight: ch, angle: 15 })
        var summary = { width: w, height: h, cells: cols * rows, diagnostics: out.diagnostics, terminalMismatches: 0, nonfinite: 0, maxRadiusError: 0, maxG4Error: 0, radiusOver1e5: 0 }
        for (var i = 0; i < cols * rows; i++) {
          var col = i % cols, row = Math.floor(i / cols), ref = UniverseGeodesic.trace((2 * (col + .5) * cw - w) / Math.min(w, h), (h - 2 * (row + .5) * ch) / Math.min(w, h), 15)
          if (ref.terminal === 'exhausted') ref = UniverseGeodesic.trace((2 * (col + .5) * cw - w) / Math.min(w, h), (h - 2 * (row + .5) * ch) / Math.min(w, h), 15, 4800)
          if (names[out.data[i * 8 + 3]] !== ref.terminal) summary.terminalMismatches++
          for (var k = 0; k < 8; k++) if (!Number.isFinite(out.data[i * 8 + k])) summary.nonfinite++
          if (ref.radius && out.data[i * 8 + 3] === 1) {
            var dr = Math.abs(ref.radius - out.data[i * 8]), dg = Math.abs(ref.g4 - out.data[i * 8 + 2])
            summary.maxRadiusError = Math.max(summary.maxRadiusError, dr); summary.maxG4Error = Math.max(summary.maxG4Error, dg)
            if (dr > 1e-5) summary.radiusOver1e5++
          }
        }
        summary.passed = !summary.terminalMismatches && !summary.nonfinite && !summary.radiusOver1e5 && summary.maxG4Error <= 1e-6 && summary.diagnostics.state === 'ready'
        report.grids.push(summary); out.dispose()
      }
    }
    report.passed = report.budgetGuard && report.cases.every(function (t) { return t.passed }) && report.grids.every(function (t) { return t.passed })
    report.status = 'completed'
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); report.passed = false }
  finally { if (gpu) gpu.dispose(); var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext() }
  return report
}
/* Actual two-pass renderer checks. Synthetic physical records isolate shading,
 * masking and atlas composition from the independently checked geodesic solver. */
UniverseGPUCheck.renderer = async function () {
  var canvas = document.createElement('canvas'), renderer, referenceProgram, referenceVao, referenceBuffer, result = { snapshots: [], passed: false }
  try {
    renderer = UniverseAccretionGPU.create(canvas, ' .-:;+*o#%@', Array(12).fill('#ffffff'), Array(12).fill('#000000'))
    var gl = renderer.gl, bind = gl.bindFramebuffer.bind(gl), stateFbo
    gl.bindFramebuffer = function (target, fbo) { if (fbo) stateFbo = fbo; return bind(target, fbo) }
    var size = { w: 320, h: 240, cw: 10, ch: 12, cols: 32, rows: 20, dpr: 1.25 }, count = size.cols * size.rows
    canvas.width = Math.round(size.w * size.dpr); canvas.height = Math.round(size.h * size.dpr)
    var data = new Float32Array(count * 8)
    for (var i = 0; i < count; i++) { data[i * 8] = 6.1 + i % 23 * .42; data[i * 8 + 1] = i % 37 * .17; data[i * 8 + 2] = .5 + i % 13 * .13; data[i * 8 + 3] = i % 7 === 0 ? 2 + i % 3 : 1 }
    function installGrid() {
      var buffer = gl.createBuffer(), released = false
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      renderer.setGrid({ buffer: buffer, data: data, dispose: function () { if (!released) { gl.deleteBuffer(buffer); released = true } } }, size)
    }
    installGrid()
    referenceVao = gl.createVertexArray(); referenceBuffer = gl.createBuffer(); gl.bindVertexArray(referenceVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, referenceBuffer); gl.bufferData(gl.ARRAY_BUFFER, Uint32Array.from({length:count}, function (_, i) { return i }), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(0, 1); gl.bindVertexArray(null)
    var patches = Array.from({length:24}, function (_, i) { return { radius: 6 + i * .42, phi: i * .37, age: i * .02, radial: .4, angular: 1, amplitude: .5 } })
    var frame = { baseX: 160, baseY: 120, viewX: 0, viewY: 0, horizon: 34, ring: null, brightness: 1, light: false, patches: patches }
    /* Frozen pre-cache state shader: require identical GPU RGBA8, not CPU tolerance. */
    var originalState = '#version 300 es\nprecision highp float;precision highp int;\n' + [
      'layout(location=0) in vec4 ray;uniform ivec2 gridSize;uniform vec2 cellSize,base;',
      'uniform float horizon,brightness,ringScale,ringClear,ringOuter;uniform int ringBins;',
      'uniform bool light;uniform highp sampler2D ringEdge;uniform vec4 patchA[24],patchB[24];flat out vec4 state;',
      'void main(){int row=gl_VertexID/gridSize.x,col=gl_VertexID-row*gridSize.x;vec2 centre=(vec2(col,row)+0.5)*cellSize;',
      'gl_Position=vec4((vec2(col,row)+0.5)/vec2(gridSize)*2.0-1.0,0,1);gl_PointSize=1.0;state=vec4(0);if(ray.w!=1.0)return;',
      'vec2 q=centre-base;float d2=dot(q,q);if(ringBins>0&&d2<ringOuter*ringOuter){float d=sqrt(d2);if(d>horizon){',
      'float az=q.x==0.0?(q.y<0.0?-1.5707963267948966:1.5707963267948966):atan(q.y,q.x);int bin=int((az+3.141592653589793)/6.283185307179586*float(ringBins))%ringBins;',
      'if(d<=texelFetch(ringEdge,ivec2(bin,0),0).r*ringScale+ringClear)return;}}',
      'float r=ray.x,phi=ray.y,omega=16.0/pow(r,1.5),emission=0.32;',
      'for(int i=0;i<24;i++){float dr=(r-patchA[i].x)*patchA[i].w;if(abs(dr)>=1.0)continue;',
      'float dp=phi-patchA[i].y-omega*patchA[i].z;dp-=6.283185307179586*floor(dp/6.283185307179586+0.5);dp*=patchB[i].x;if(abs(dp)>=1.0)continue;',
      'float radial=1.0-dr*dr,angular=1.0-dp*dp;emission+=patchB[i].y*radial*radial*radial*angular*angular*angular;}',
      'float edge=smoothstep(5.8,6.8,r)*(1.0-smoothstep(14.5,16.2,r));float flux=edge*pow(6.0/r,2.0)*emission*ray.z*3.2;',
      'float value=flux>0.0?1.0-exp(-flux*brightness):0.0;if(value<=0.004)return;float shown=min(0.999,pow(value,0.45));',
      'int glyph=min(10,int(floor(shown*10.0+0.5))),bucket=min(11,int(shown*12.0));bool luminous=!light;',
      'state=vec4(float(glyph),float(bucket),luminous?1.0:0.0,glyph>0?1.0:0.0)/255.0;}'
    ].join('\n')
    referenceProgram = UniverseGeodesicGPU.program(gl, originalState, UniverseAccretionGPU.sources().statePixel)
    var full = false, submittedState = 0, submittedGlyphs = 0, uploads = 0, ringUploads = 0, preparations = 0, submittedIndices = []
    var elements = gl.drawElements.bind(gl), arrays = gl.drawArrays.bind(gl), instances = gl.drawArraysInstanced.bind(gl), bufferData = gl.bufferData.bind(gl)
    var image = gl.texImage2D.bind(gl), subImage = gl.texSubImage2D.bind(gl)
    gl.texImage2D = function () { if (arguments[2] === gl.R32F) ringUploads++; return image.apply(null, arguments) }
    gl.texSubImage2D = function () { ringUploads++; return subImage.apply(null, arguments) }
    gl.drawArrays = function () { preparations++; return arrays.apply(null, arguments) }
    gl.drawElements = function (mode, n, type, offset) {
      if (!full) { submittedState = n; return elements(mode, n, type, offset) }
      gl.useProgram(referenceProgram)
      function loc(name) { return gl.getUniformLocation(referenceProgram, name) }
      var ring=frame.ring,bins=ring?ring.edge.length:0,scale=ring?frame.horizon/ring.horizon:1,pad=Math.hypot(size.cw,size.ch)/2+1
      gl.uniform1i(loc('ringEdge'),0);gl.uniform2i(loc('gridSize'),size.cols,size.rows);gl.uniform2f(loc('cellSize'),size.cw,size.ch);gl.uniform2f(loc('base'),frame.baseX,frame.baseY)
      gl.uniform1f(loc('horizon'),frame.horizon);gl.uniform1f(loc('brightness'),frame.brightness);gl.uniform1i(loc('light'),frame.light?1:0)
      gl.uniform1i(loc('ringBins'),bins);gl.uniform1f(loc('ringScale'),scale);gl.uniform1f(loc('ringClear'),pad);gl.uniform1f(loc('ringOuter'),bins?ring.edgeMax*scale+pad:0)
      var a=new Float32Array(96),b=new Float32Array(96)
      patches.forEach(function(p,i){a.set([p.radius,p.phi,p.age,p.radial],i*4);b.set([p.angular,p.amplitude,0,0],i*4)})
      gl.uniform4fv(loc('patchA[0]'),a);gl.uniform4fv(loc('patchB[0]'),b)
      return arrays(mode,0,count)
    }
    gl.drawArraysInstanced = function (mode, first, n, total) { if (full) gl.bindVertexArray(referenceVao); else submittedGlyphs = total; return instances(mode, first, n, full ? count : total) }
    gl.bufferData = function (target, data, usage) { if (target === gl.ELEMENT_ARRAY_BUFFER) { uploads++; submittedIndices = Array.from(data) } return bufferData(target, data, usage) }
    function expected(index) {
      if (data[index * 8 + 3] !== 1) return { value: [0,0,0,0] }
      var x = (index % size.cols + .5) * size.cw - frame.baseX, y = (Math.floor(index / size.cols) + .5) * size.ch - frame.baseY, d = Math.hypot(x, y), ring = frame.ring
      if (ring) {
        var scale = frame.horizon / ring.horizon, pad = Math.hypot(size.cw, size.ch) / 2 + 1, bin = Math.floor((Math.atan2(y,x) + Math.PI) / (2 * Math.PI) * ring.edge.length) % ring.edge.length
        if (d < ring.edgeMax * scale + pad && d > frame.horizon && d <= ring.edge[bin] * scale + pad) return { value: [0,0,0,0] }
      }
      var r = data[index * 8], phi = data[index * 8 + 1], omega = 16 / Math.pow(r,1.5), emission = .32
      patches.forEach(function (p) { var dr = (r-p.radius)*p.radial, dp=phi-p.phi-omega*p.age; dp-=2*Math.PI*Math.round(dp/(2*Math.PI)); dp*=p.angular; if(Math.abs(dr)<1&&Math.abs(dp)<1)emission+=p.amplitude*Math.pow(1-dr*dr,3)*Math.pow(1-dp*dp,3) })
      function smooth(a,b,v){v=Math.max(0,Math.min(1,(v-a)/(b-a)));return v*v*(3-2*v)}
      var flux=smooth(5.8,6.8,r)*(1-smooth(14.5,16.2,r))*Math.pow(6/r,2)*emission*data[index*8+2]*3.2, value=flux>0?1-Math.exp(-flux*frame.brightness):0
      if(value<=.004)return {value:[0,0,0,0]}
      var shown=Math.min(.999,Math.pow(value,.45)), glyph=Math.min(10,Math.floor(shown*10+.5)), bucket=Math.min(11,Math.floor(shown*12))
      return {value:[glyph,bucket,!frame.light?1:0,glyph>0?1:0],near:Math.abs(shown*10+.5-Math.round(shown*10+.5))<1e-4||Math.abs(shown*12-Math.round(shown*12))<1e-4}
    }
    function check(name, prepared, uploaded) {
      submittedState = 0; submittedGlyphs = 0
      var oldPreparations=preparations,oldRingUploads=ringUploads
      renderer.draw(size,frame)
      var preparationDelta=preparations-oldPreparations,ringUploadDelta=ringUploads-oldRingUploads
      var pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
      var visible=0;for(var p=3;p<pixels.length;p+=4)if(pixels[p])visible++
      bind(gl.FRAMEBUFFER,stateFbo);var states=new Uint8Array(count*4);gl.readPixels(0,0,size.cols,size.rows,gl.RGBA,gl.UNSIGNED_BYTE,states);bind(gl.FRAMEBUFFER,null)
      var mismatches=0,thresholdDifferences=0
      var qw=(Math.ceil(size.cw*size.dpr)+4)/size.dpr,qh=(Math.ceil(size.ch*size.dpr)+4)/size.dpr,expectedIndices=[],rectangleCells=0
      for(var j=0;j<count;j++){
        var x=(j%size.cols+.5)*size.cw+frame.viewX,y=(Math.floor(j/size.cols)+.5)*size.ch+frame.viewY
        if(x+qw/2<=0||x-qw/2>=size.w||y+qh/2<=0||y-qh/2>=size.h)continue
        rectangleCells++
        if(data[j*8+3]===1)expectedIndices.push(j)
        var exp=expected(j),different=exp.value.some(function(v,k){return v!==states[j*4+k]})
        if(different){if(exp.near&&states[j*4+2]===exp.value[2]&&states[j*4+3]===exp.value[3])thresholdDifferences++;else mismatches++}
      }
      var before=uploads,beforePreparation=preparations,beforeRingUpload=ringUploads;renderer.draw(size,frame)
      var cached=uploads===before&&preparations===beforePreparation&&ringUploads===beforeRingUpload
      full=true;renderer.draw(size,frame);full=false
      var reference=new Uint8Array(pixels.length);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,reference)
      bind(gl.FRAMEBUFFER,stateFbo);var referenceStates=new Uint8Array(count*4);gl.readPixels(0,0,size.cols,size.rows,gl.RGBA,gl.UNSIGNED_BYTE,referenceStates);bind(gl.FRAMEBUFFER,null)
      var stateDifferences=0;expectedIndices.forEach(function(index){for(var k=0;k<4;k++)if(states[index*4+k]!==referenceStates[index*4+k])stateDifferences++})
      var pixelDifferences=0;for(var k=0;k<pixels.length;k++)if(pixels[k]!==reference[k])pixelDifferences++
      var expectedCells=expectedIndices.length,ordered=JSON.stringify(submittedIndices)===JSON.stringify(expectedIndices)
      var error=gl.getError();result.snapshots.push({name:name,mismatches:mismatches,thresholdDifferences:thresholdDifferences,visiblePixels:visible,submittedCells:submittedState,rectangleCells:rectangleCells,totalCells:count,pixelDifferences:pixelDifferences,stateDifferences:stateDifferences,preparations:preparationDelta,ringUploads:ringUploadDelta,cached:cached,ordered:ordered,glError:error,passed:mismatches===0&&stateDifferences===0&&pixelDifferences===0&&preparationDelta===prepared&&ringUploadDelta===uploaded&&cached&&ordered&&submittedState===expectedCells&&submittedGlyphs===expectedCells&&renderer.stats().visibleCells===expectedCells&&(expectedCells===0||visible>0)&&error===0})
    }
    check('dark/no ring',1,0);frame.light=true;frame.brightness=.4;check('light/no ring',0,0)
    for(var t=0;t<12;t++){patches.forEach(function(p,i){p.age=t*.37+i*.02});frame.brightness=.05+t*.31;check('dynamic patches/brightness '+t,0,0)}
    frame.ring={horizon:34,edgeMax:400,edge:new Float32Array(360).fill(60)};check('ring keepout',1,1)
    for(var e=0;e<360;e++)frame.ring.edge[e]=e%7===0?0:400
    frame.viewX=37.25;frame.viewY=-11.5;check('in-place ring and fractional view',1,1)
    frame.viewX=160;frame.viewY=0;check('dialog half-view',0,0)
    frame.viewX=-160;frame.viewY=6.25;check('negative view',0,0)
    frame.viewX=4000;check('fully offscreen',0,0)
    frame.viewX=0;frame.viewY=0;check('return to full view',0,0)
    frame.ring={horizon:34,edgeMax:400,edge:new Float32Array(frame.ring.edge)};check('new ring with identical contents',0,0)
    frame.horizon=36;check('horizon changes',1,0)
    frame.ring.horizon=35;check('ring scale changes',1,0)
    frame.ring.edgeMax=401;check('ring outer bound changes',1,0)
    frame.baseX+=.25;check('physical centre changes',1,0)
    var savedRing=frame.ring;frame.ring=null;check('remove ring',1,0)
    frame.ring=savedRing;check('restore identical ring',1,0)
    frame.ring.edge=new Float32Array(180).fill(80);check('ring bins change',1,1)
    frame.ring.edge=new Float32Array([80]);check('one-bin ring replaces old texture',1,1)
    frame.ring.edge[0]=81;check('same-length ring upload',1,1)
    frame.ring=null;for(var j=0;j<count;j++)data[j*8+3]=2
    installGrid();check('rebuilt grid with no disk cells',0,0)
    for(var j=0;j<count;j++)data[j*8+3]=j%3===0?1:3
    installGrid();check('rebuilt grid at unchanged visible bounds',1,0)
    for(var j=0;j<count;j++){data[j*8]=6.4+j%19*.48;data[j*8+1]=j%29*.21;data[j*8+2]=.3+j%11*.16}
    installGrid();check('rebuilt physical values with unchanged terminals',1,0)
    size.cols=40;size.rows=16;size.cw=8;size.ch=15
    installGrid();check('rebuilt grid geometry',1,0)
    result.passed=result.snapshots.every(function(s){return s.passed});result.renderer=gl.getParameter(gl.RENDERER)
    return result
  } catch(error) {result.error=String(error.stack||error);return result}
  finally {if(renderer){var context=renderer.gl;if(referenceProgram)context.deleteProgram(referenceProgram);if(referenceVao)context.deleteVertexArray(referenceVao);if(referenceBuffer)context.deleteBuffer(referenceBuffer);renderer.dispose();var lose=context.getExtension('WEBGL_lose_context');if(lose)lose.loseContext()}globalThis.__QUASAR_GPU_RENDER_CHECK=result}
}
/* Match the existing CPU tests' diagnostic injection: preserve the production
 * transfer equations, but expose their low components before display quantization.
 * This is a same-event algebra check, not an independent trajectory reference. */
UniverseGPUCheck.sameEvent = function (gl, raw) {
  var source = UniverseGeodesicGPU.shaders().finish
  var outputs = 'out vec4 rayGeometry;out vec4 rayAux;', calc = 'g4=val(dm(g2,g2));'
  if (source.split(outputs).length !== 2 || source.split(calc).length !== 2) throw Error('GPU diagnostic injection anchors changed')
  source = source.replace(outputs, outputs + 'out vec4 diagnostic0,diagnostic1;').replace('void main(){', 'void main(){diagnostic0=vec4(0);diagnostic1=vec4(0);').replace(calc, 'vec2 fourth=dm(g2,g2);g4=val(fourth);diagnostic0=vec4(r,g);diagnostic1=vec4(fourth,rayConstants.xy);')
  var p, input, output, vao
  try {
    p = UniverseGeodesicGPU.program(gl, source, null, ['diagnostic0', 'diagnostic1'])
    vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    input = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, input); gl.bufferData(gl.ARRAY_BUFFER, raw, gl.STATIC_DRAW)
    for (var i = 0; i < 3; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 4, gl.FLOAT, false, 48, i * 16) }
    var data = new Float32Array(raw.length / 12 * 8)
    output = gl.createBuffer(); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output); gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, data.byteLength, gl.STREAM_READ)
    gl.useProgram(p); gl.uniform1ui(gl.getUniformLocation(p, 'arithmeticMask'), 0xffffffff)
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output); gl.enable(gl.RASTERIZER_DISCARD)
    gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, raw.length / 12); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD)
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null); gl.bindBuffer(gl.ARRAY_BUFFER, output); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data)
    var error = gl.getError(); if (error) throw Error('GPU same-event diagnostic GL error ' + error)
    return data
  } finally { gl.bindVertexArray(null); if (p) gl.deleteProgram(p); if (input) gl.deleteBuffer(input); if (output) gl.deleteBuffer(output); if (vao) gl.deleteVertexArray(vao) }
}
/* Isolate compensated primitives from the long integration loop. */
UniverseGPUCheck.arithmetic = function () {
  var gl = document.createElement('canvas').getContext('webgl2', { antialias: false, failIfMajorPerformanceCaveat: true })
  if (!gl) throw Error('Hardware WebGL2 unavailable')
  var p, input, output, vao
  try {
    var header = UniverseGeodesicGPU.shaders().finish.split('layout(location=0)')[0]
    var vertex = header + 'layout(location=0) in vec4 values;out vec4 sums;out vec4 quotients;void main(){vec2 a=values.xy,b=values.zw;sums=vec4(da(a,b),dm(a,b));quotients=vec4(dd(a,b),root(ab(a)));gl_Position=vec4(0,0,0,1);}'
    p = UniverseGeodesicGPU.program(gl, vertex, null, ['sums', 'quotients'])
    var cases = [[1 + Math.pow(2, -30), 1 - Math.pow(2, -29)], [.00014969740382552067, -.00014969056320869066], [60, .25881904510252074], [3.141592653589793, .03419957408555463], [9.35e-10, 3.2e-4]]
    var packed = new Float32Array(cases.length * 4)
    cases.forEach(function (row, i) { packed.set(UniverseGeodesicGPU.pair(row[0]), i * 4); packed.set(UniverseGeodesicGPU.pair(row[1]), i * 4 + 2) })
    vao = gl.createVertexArray(); gl.bindVertexArray(vao)
    input = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, input); gl.bufferData(gl.ARRAY_BUFFER, packed, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0)
    output = gl.createBuffer(); gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output); gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, cases.length * 32, gl.STREAM_READ)
    gl.useProgram(p); gl.uniform1ui(gl.getUniformLocation(p, 'arithmeticMask'), 0xffffffff); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output); gl.enable(gl.RASTERIZER_DISCARD)
    gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, cases.length); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
    var values = new Float32Array(cases.length * 8); gl.bindBuffer(gl.ARRAY_BUFFER, output); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, values)
    return { error: gl.getError(), rows: cases.map(function (row, i) { var expected = [row[0] + row[1], row[0] * row[1], row[0] / row[1], Math.sqrt(Math.abs(row[0]))], actual = expected.map(function (_, k) { return values[i * 8 + k * 2] + values[i * 8 + k * 2 + 1] }); return { input: row, expected: expected, actual: actual, absoluteError: actual.map(function (v, k) { return Math.abs(v - expected[k]) }) } }) }
  } finally { gl.bindVertexArray(null); if (p) gl.deleteProgram(p); if (input) gl.deleteBuffer(input); if (output) gl.deleteBuffer(output); if (vao) gl.deleteVertexArray(vao); var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext() }
}

/* Test-only native Canvas2D baseline versus the actual two-pass renderer.
 * Both consume the SAME completed GPU physical grid, font, palette and time.
 * No CPU physical solver or Canvas fallback is added to production. No finish,
 * readPixels or readback occurs inside the measured frame loop. */
UniverseGPUCheck.performance = async function (options) {
  options = options || {}
  var canvas = document.createElement('canvas'), baseline = document.createElement('canvas'), renderer
  var report = { status: 'running', passed: false, scope: 'character frames only; no static hole/ring, fixed view and emission time', environment: { userAgent: navigator.userAgent, visible: !document.hidden } }
  globalThis.__QUASAR_GPU_PERFORMANCE = report
  try {
    if (document.hidden) throw Error('Keep the test tab visible; background timing is excluded')
    var dark = ['#2a1a12','#3d2719','#4f321d','#623f22','#774c27','#8d5a2e','#a46a36','#bb7c40','#d0904b','#e3a65c','#f2bd75','#ffe0a8'], light = Array(12).fill('#000000'), glyphs = ' .-:;+*o#%@'
    var w = options.width || 2400, h = options.height || 1350, dpr = Math.min(devicePixelRatio || 1, 1.5)
    var cw = Math.max(6, Math.sqrt(w * h / 24000)), cols = Math.max(1, Math.floor(w / cw)); cw = w / cols
    var rows = Math.max(1, Math.floor(h / (cw * 1.5))), ch = h / rows, size = { w: w, h: h, cw: cw, ch: ch, cols: cols, rows: rows, dpr: dpr }
    canvas.width = baseline.width = Math.round(w * dpr); canvas.height = baseline.height = Math.round(h * dpr)
    renderer = UniverseAccretionGPU.create(canvas, glyphs, dark, light)
    var gl = renderer.gl, debug = gl.getExtension('WEBGL_debug_renderer_info')
    report.environment.renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    var buildStart = performance.now()
    var physical = await renderer.build({ width: w, height: h, columns: cols, rows: rows, cellWidth: cw, cellHeight: ch, angle: 15 })
    report.buildAndCompileWallMs = performance.now() - buildStart; report.build = physical.diagnostics
    if (physical.diagnostics.state !== 'ready') { physical.dispose(); throw Error('Physical grid did not complete') }
    var data = physical.data, rays = []
    for (var i = 0; i < cols * rows; i++) rays.push(data[i * 8 + 3] === 1 ? { radius: data[i * 8], phi: data[i * 8 + 1], g4: data[i * 8 + 2] } : null)
    renderer.setGrid(physical, size)
    function key(a, b) { var x = Math.imul(a, 374761393) ^ Math.imul(b, 668265263); x = Math.imul(x ^ (x >>> 13), 1274126177); return x ^ (x >>> 16) }
    var time = .37, patches = [], tau = Math.PI * 2
    for (var j = 0; j < 24; j++) {
      var radius = 6 + 10 * (j + .5) / 24, life = .9 * tau / (16 / Math.pow(radius, 1.5)), clock = time / life + (key(j, -1) >>> 0) / 4294967296
      var age = (clock - Math.floor(clock)) * life, seed = (key(j, Math.floor(clock)) >>> 0) / 4294967296, fade = Math.sin(Math.PI * age / life)
      patches.push({ radius: radius, age: age, phi: seed * tau, radial: 1 / (radius * .24), angular: 1 / (.45 + .5 * seed), amplitude: (1.5 + seed) * fade * fade })
    }
    var frame = { baseX: w / 2, baseY: h / 2, viewX: 0, viewY: 0, horizon: UniverseGeodesic.ratio * Math.min(w, h) / 2, brightness: 1, light: false, ring: null, patches: patches }
    var ctx = baseline.getContext('2d', { alpha: true })
    if (!ctx) throw Error('Canvas2D baseline unavailable')
    function cpuFrame() {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, baseline.width, baseline.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.font = '600 ' + Math.round(ch * .95) + 'px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      for (var n = 0; n < rays.length; n++) {
        if (!rays[n]) continue
        var value = UniverseAccretionDisk.shade(rays[n], time, 1)
        if (!(value > .004)) continue
        var shown = Math.min(.999, Math.pow(value, .45)), glyph = glyphs.charAt(Math.min(10, Math.floor(shown * 10 + .5))), bucket = Math.min(11, Math.floor(shown * 12))
        ctx.fillStyle = dark[bucket]; ctx.fillText(glyph, (n % cols + .5) * cw, (Math.floor(n / cols) + .5) * ch, cw)
      }
    }
    var cpuTimes = [], gpuSubmitTimes = [], gpuSamples = [], previousGpuSample = 0, skippedGpuSamples = 0
    var warmup = 20, count = Math.min(240, Math.max(30, options.frames || 120))
    function timed(fn) { var start = performance.now(); fn(); return performance.now() - start }
    for (var f = 0; f < warmup + count; f++) {
      await new Promise(function (resolve) { requestAnimationFrame(resolve) })
      if (document.hidden) throw Error('Tab hidden during test; frame timing excluded')
      var cpuMs, submitMs
      if (f % 2) { cpuMs = timed(cpuFrame); submitMs = timed(function () { renderer.draw(size, frame) }) }
      else { submitMs = timed(function () { renderer.draw(size, frame) }); cpuMs = timed(cpuFrame) }
      if (f >= warmup) { cpuTimes.push(cpuMs); gpuSubmitTimes.push(submitMs) }
      var gpu = renderer.stats()
      if (gpu.frameGpuSampleCount !== previousGpuSample) {
        if (gpu.frameGpuSampleFrame >= warmup && gpu.frameGpuMs != null) {
          gpuSamples.push(gpu.frameGpuMs)
          skippedGpuSamples += Math.max(0, gpu.frameGpuSampleCount - previousGpuSample - 1)
        }
        previousGpuSample = gpu.frameGpuSampleCount
      }
    }
    function summary(values) { var sorted = values.slice().sort(function (a, b) { return a - b }); return sorted.length ? { samples: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] } : null }
    report.size = size; report.cells = cols * rows; report.cpuCanvasSubmission = summary(cpuTimes); report.webglCpuSubmission = summary(gpuSubmitTimes); report.webglGpuExecution = summary(gpuSamples)
    report.gpuQuerySamplesSkipped = skippedGpuSamples
    report.glError = gl.getError(); report.passed = report.glError === 0; report.status = 'completed'
    report.notes = 'CPU numbers measure main-thread submission, not Canvas raster completion; GPU timer covers both actual WebGL passes. Not a power or full-startup comparison.'
  } catch (error) { report.status = 'failed'; report.error = error.stack || String(error); report.passed = false }
  finally { if (renderer) { var context = renderer.gl; renderer.dispose(); var lose = context.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext() } }
  return report
}
