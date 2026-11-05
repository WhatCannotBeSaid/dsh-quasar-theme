/* GPU geodesics. The constants and DP tableau come from the reference kernel.
 * Position, momentum, coefficients and event interpolation use two-float arithmetic;
 * native highp alone cannot resolve the existing near-critical ray contracts.
 * Integration and transfer/output are separate transform-feedback programs. No
 * per-cell CPU trace, float render target extension, or per-frame readback is used. */
var UniverseGeodesicGPU = (function () {
  function pair(value) { var hi = Math.fround(value); return [hi, Math.fround(value - hi)] }
  function literal(value) {
    var s = Number(value).toPrecision(9)
    return /[.eE]/.test(s) ? s : s + '.0'
  }
  function constant(value) { var p = pair(value); return 'vec2(' + literal(p[0]) + ',' + literal(p[1]) + ')' }
  /* The runtime bit mask is exactly all bits set. Keeping that value outside the
   * compiler's constant graph forces each compensated intermediate to round: ANGLE
   * otherwise reassociates TwoSum/Dekker and erases their low components. */
  var arithmetic = [
    'uniform highp uint arithmeticMask;',
    'uniform highp int arithmeticComponents,arithmeticStages,eventSteps;',
    'float rn(float x){return uintBitsToFloat(floatBitsToUint(x)&arithmeticMask);}',
    'vec2 ds(float x){return vec2(x,0.0);}',
    'vec2 dn(float a,float b){float s=rn(a+b);return vec2(s,rn(b-rn(s-a)));}',
    'vec2 da(vec2 a,vec2 b){float s=rn(a.x+b.x);float v=rn(s-a.x);float e=rn(rn(a.x-rn(s-v))+rn(b.x-v));return dn(s,rn(rn(e+a.y)+b.y));}',
    'vec2 neg(vec2 a){return -a;}',
    'vec2 sub(vec2 a,vec2 b){return da(a,-b);}',
    'float head(float a){return uintBitsToFloat(floatBitsToUint(a)&0xfffff000u);}',
    'vec2 dm(vec2 a,vec2 b){float p=rn(a.x*b.x);float ah=head(a.x),bh=head(b.x);float al=rn(a.x-ah),bl=rn(b.x-bh);float e=rn(rn(rn(rn(ah*bh)-p)+rn(ah*bl))+rn(al*bh));e=rn(e+rn(al*bl));e=rn(rn(e+rn(a.x*b.y))+rn(a.y*b.x));return dn(p,e);}',
    'vec2 dd(vec2 a,vec2 b){float q=rn(a.x/b.x);vec2 r=sub(a,dm(b,ds(q)));return da(ds(q),ds(rn(rn(r.x+r.y)/b.x)));}',
    'bool lt(vec2 a,vec2 b){return a.x<b.x||(a.x==b.x&&a.y<b.y);}',
    'bool zero(vec2 a){return a.x==0.0&&a.y==0.0;}',
    'vec2 ab(vec2 a){return lt(a,ds(0.0))?-a:a;}',
    'vec2 mx(vec2 a,vec2 b){return lt(a,b)?b:a;}',
    'vec2 mn(vec2 a,vec2 b){return lt(a,b)?a:b;}',
    'float val(vec2 a){return a.x+a.y;}',
    'bool finiteD(vec2 a){return !any(isnan(a))&&!any(isinf(a));}',
    'vec2 root(vec2 a){if(zero(a))return ds(0.0);vec2 q=ds(sqrt(a.x));return da(q,dd(sub(a,dm(q,q)),dm(ds(2.0),q)));}'
  ].join('\n')
  function prelude() {
    var g = UniverseGeodesic, p = g.gpu
    var values = { C_DISTANCE: g.distance, C_TAN: g.tanHalf, C_INNER: g.inner, C_OUTER: g.outer,
      C_TOL: p.tolerance, C_MAX: p.stepMax, C_CAP: p.angleCap, C_CAPTURE: p.captureRadius,
      C_ESCAPE: p.escapeRadius, C_CRITICAL: p.criticalImpact, C_RING: p.ringCore, C_FD: p.sqrtFD }
    var text = '#version 300 es\nprecision highp float;\nprecision highp int;\n' + arithmetic + '\n'
    Object.keys(values).forEach(function (key) { text += 'const vec2 ' + key + '=' + constant(values[key]) + ';\n' })
    return text
  }
  function shaders() {
    var g = UniverseGeodesic, a = [], i, j
    for (i = 0; i < 7; i++) for (j = 0; j < 7; j++) a.push(constant(i > 0 && j < i ? g.gpu.dpA[i - 1][j] || 0 : 0))
    var header = prelude()
    var trace = header + '\n' + [
      'const vec2 A[49]=vec2[49](' + a.join(',') + ');',
      'const vec2 B[7]=vec2[7](' + g.gpu.dpB.map(constant).join(',') + ');',
      'const vec2 E[7]=vec2[7](' + g.gpu.dpE.map(constant).join(',') + ');',
      'layout(location=0) in vec4 explicitUV;',
      'uniform vec2 sineAngle,cosineAngle,viewWidth,viewHeight,cellWidth,cellHeight,shortSide;',
      'uniform int columns,firstRay,initialBudget;uniform bool explicitRays;',
      'out vec4 rawPlane;out vec4 rawInvariant;out vec4 rawMeta;',
      'vec2 S[6],N[6],R[6],K[42];vec2 L2,axisB,hitX,hitZ;float terminal;int steps;',
      'void stepD(vec2 h){',
      'for(int stage=0;stage<arithmeticStages;stage++){vec2 q[6];for(int c=0;c<arithmeticComponents;c++)q[c]=S[c];',
      'for(int j=0;j<arithmeticStages;j++){if(j>=stage)break;vec2 w=dm(h,A[stage*7+j]);if(zero(w))continue;for(int c=0;c<arithmeticComponents;c++)q[c]=da(q[c],dm(w,K[j*6+c]));}',
      'vec2 r2=da(da(dm(q[0],q[0]),dm(q[1],q[1])),dm(q[2],q[2]));',
      'vec2 k=dd(dm(ds(-3.0),L2),dm(dm(r2,r2),root(r2)));',
      'for(int c=0;c<arithmeticComponents/2;c++){K[stage*6+c]=q[c+3];K[stage*6+c+3]=dm(k,q[c]);}}',
      'for(int c=0;c<arithmeticComponents;c++){vec2 sum=ds(0.0),err=ds(0.0);for(int j=0;j<arithmeticStages;j++){sum=da(sum,dm(B[j],K[j*6+c]));err=da(err,dm(E[j],K[j*6+c]));}N[c]=da(S[c],dm(h,sum));R[c]=dm(h,err);}}',
      'vec2 herm(vec2 t,vec2 h,vec2 p0,vec2 m0,vec2 p1,vec2 m1){',
      'vec2 t2=dm(t,t),t3=dm(t2,t);vec2 a=da(sub(dm(ds(2.0),t3),dm(ds(3.0),t2)),ds(1.0));',
      'vec2 b=da(sub(t3,dm(ds(2.0),t2)),t);vec2 c=da(dm(ds(-2.0),t3),dm(ds(3.0),t2));vec2 d=sub(t3,t2);',
      'return da(da(da(dm(a,p0),dm(dm(b,h),m0)),dm(c,p1)),dm(dm(d,h),m1));}',
      'vec2 crossing(vec2 h){if(zero(S[1]))return ds(-1.0);if(zero(N[1]))return ds(1.0);',
      'vec2 lo=ds(0.0),hi=ds(1.0);for(int k=0;k<eventSteps;k++){vec2 t=dm(da(lo,hi),ds(0.5));vec2 f=herm(t,h,S[1],S[4],N[1],N[4]);if(lt(f,ds(0.0))==lt(S[1],ds(0.0)))lo=t;else hi=t;}return dm(da(lo,hi),ds(0.5));}',
      'void integrate(vec2 u,vec2 v,int budget){',
      'terminal=4.0;steps=0;hitX=ds(0.0);hitZ=ds(0.0);',
      'S[0]=ds(0.0);S[1]=dm(C_DISTANCE,sineAngle);S[2]=dm(C_DISTANCE,cosineAngle);',
      'S[3]=dm(u,C_TAN);S[4]=da(-sineAngle,dm(dm(v,C_TAN),cosineAngle));S[5]=sub(-cosineAngle,dm(dm(v,C_TAN),sineAngle));',
      'vec2 len=root(da(da(dm(S[3],S[3]),dm(S[4],S[4])),dm(S[5],S[5])));for(int c=3;c<arithmeticComponents;c++)S[c]=dd(S[c],len);',
      'vec2 lx=sub(dm(S[1],S[5]),dm(S[2],S[4]));vec2 ly=sub(dm(S[2],S[3]),dm(S[0],S[5]));vec2 lz=sub(dm(S[0],S[4]),dm(S[1],S[3]));',
      'L2=da(da(dm(lx,lx),dm(ly,ly)),dm(lz,lz));vec2 e0=root(sub(ds(1.0),dd(dm(ds(2.0),L2),dm(dm(C_DISTANCE,C_DISTANCE),C_DISTANCE))));axisB=lt(ds(0.0),e0)?dd(ly,e0):ds(0.0);',
      'vec2 inverse=lt(ds(0.0),L2)?dd(ds(1.0),root(L2)):ds(0.0);vec2 h=ds(0.25);',
      'for(int attempt=0;attempt<=budget;attempt++){',
      'vec2 r2=da(da(dm(S[0],S[0]),dm(S[1],S[1])),dm(S[2],S[2]));vec2 r=root(r2);',
      'if(!finiteD(r)){terminal=5.0;return;}if(lt(r,C_CAPTURE)){terminal=2.0;return;}',
      'vec2 outward=da(da(dm(S[0],S[3]),dm(S[1],S[4])),dm(S[2],S[5]));if(lt(C_ESCAPE,r)&&lt(ds(0.0),outward)){terminal=3.0;return;}',
      'if(steps>=budget)return;vec2 hh=h;if(!zero(inverse))hh=mn(hh,dm(dm(C_CAP,r2),inverse));hh=mn(hh,C_MAX);stepD(hh);steps++;',
      'vec2 scale=ds(0.0);for(int c=0;c<arithmeticComponents;c++){vec2 err=dd(ab(R[c]),dm(C_TOL,da(ds(1.0),mx(ab(S[c]),ab(N[c])))));scale=mx(scale,err);}',
      'if(!finiteD(scale)){terminal=5.0;return;}float sc=val(scale);if(lt(ds(1.0),scale)){h=dm(hh,ds(max(0.1,0.9*pow(sc,-0.2))));continue;}',
      'if((lt(S[1],ds(0.0))!=lt(N[1],ds(0.0))&&!zero(S[1])&&!zero(N[1]))||(zero(N[1])&&!zero(S[1]))){',
      'vec2 t=crossing(hh);if(lt(ds(0.0),t)){vec2 qx=herm(t,hh,S[0],S[3],N[0],N[3]);vec2 qz=herm(t,hh,S[2],S[5],N[2],N[5]);vec2 dr=root(da(dm(qx,qx),dm(qz,qz)));',
      'if(!lt(dr,C_INNER)&&!lt(C_OUTER,dr)){hitX=qx;hitZ=qz;terminal=1.0;return;}}}',
      'for(int c=0;c<arithmeticComponents;c++)S[c]=N[c];h=dm(hh,ds(sc>0.0?min(4.0,max(0.2,0.9*pow(sc,-0.2))):4.0));}}',
      'void main(){int index=firstRay+gl_VertexID;vec2 u,v;if(explicitRays){u=explicitUV.xy;v=explicitUV.zw;}else{int row=index/columns,col=index-row*columns;',
      'u=dd(sub(dm(ds(2.0*(float(col)+0.5)),cellWidth),viewWidth),shortSide);v=dd(sub(viewHeight,dm(ds(2.0*(float(row)+0.5)),cellHeight)),shortSide);}',
      'integrate(u,v,initialBudget);int firstSteps=steps;bool retried=terminal==4.0;if(retried)integrate(u,v,initialBudget*2);',
      'rawPlane=vec4(hitX,hitZ);rawInvariant=vec4(axisB,L2);rawMeta=vec4(terminal,float(steps),float(firstSteps),retried?1.0:0.0);gl_Position=vec4(0.0,0.0,0.0,1.0);}'
    ].join('\n')
    var finish = header + '\n' + [
      'layout(location=0) in vec4 plane;layout(location=1) in vec4 rayConstants;layout(location=2) in vec4 meta;',
      'out vec4 rayGeometry;out vec4 rayAux;',
      'void main(){float terminal=meta.x;float radius=0.0,phi=0.0,g4=0.0;',
      'vec2 impact=root(rayConstants.zw);vec2 delta=dd(sub(impact,C_CRITICAL),C_RING);float ring=exp(-val(dm(delta,delta)));',
      'if(terminal==1.0){vec2 r=root(da(dm(plane.xy,plane.xy),dm(plane.zw,plane.zw)));radius=val(r);',
      'vec2 omega=dd(ds(1.0),dm(r,root(r)));vec2 g=dd(root(sub(ds(1.0),dd(ds(3.0),r))),dm(C_FD,sub(ds(1.0),dm(omega,rayConstants.xy))));vec2 g2=dm(g,g);g4=val(dm(g2,g2));',
      'float x=val(plane.xy),z=val(plane.zw);phi=x==0.0?(z<0.0?-1.5707963267948966:1.5707963267948966):atan(z,x);',
      'if(!(radius>=6.0&&radius<=16.0)||isnan(g4)||isinf(g4)||isnan(phi)||isinf(phi))terminal=5.0;}',
      'rayGeometry=vec4(radius,phi,g4,terminal);rayAux=vec4(ring,val(impact),meta.y,meta.w);gl_Position=vec4(0.0,0.0,0.0,1.0);}'
    ].join('\n')
    return { trace: trace, finish: finish }
  }
  var fragment = '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.0);}'
  function program(gl, vertex, pixel, varyings) {
    var p = gl.createProgram(), owned = []
    try {
      ;[[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, pixel || fragment]].forEach(function (input) {
        var s = gl.createShader(input[0]); owned.push(s); gl.shaderSource(s, input[1]); gl.compileShader(s)
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('QUASAR shader: ' + gl.getShaderInfoLog(s))
        gl.attachShader(p, s)
      })
      if (varyings) gl.transformFeedbackVaryings(p, varyings, gl.INTERLEAVED_ATTRIBS)
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error('QUASAR link: ' + gl.getProgramInfoLog(p) + '; GL=' + gl.getError() + '; lost=' + gl.isContextLost() + '; shaders=' + owned.map(function (s) { return gl.getShaderParameter(s, gl.COMPILE_STATUS) + ':' + gl.getShaderInfoLog(s) }).join(' | '))
      return p
    } catch (error) { gl.deleteProgram(p); throw error }
    finally { owned.forEach(function (s) { gl.deleteShader(s) }) }
  }
  async function programAsync(gl, vertex, pixel, varyings, signal) {
    var p = gl.createProgram(), owned = [], extension = gl.getExtension('KHR_parallel_shader_compile')
    function cancelled() { var e = Error('QUASAR GPU compilation cancelled'); e.cancelled = true; return e }
    try {
      if (signal && signal.aborted) throw cancelled()
      // The compensated solver can compile slowly. Never block the UI on a
      // driver without a non-blocking completion query; fail only this layer.
      if (!extension) throw Error('QUASAR physical GPU requires KHR_parallel_shader_compile to avoid blocking the interface')
      ;[[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, pixel || fragment]].forEach(function (input) {
        var s = gl.createShader(input[0]); owned.push(s); gl.shaderSource(s, input[1]); gl.compileShader(s); gl.attachShader(p, s)
      })
      if (varyings) gl.transformFeedbackVaryings(p, varyings, gl.INTERLEAVED_ATTRIBS)
      gl.linkProgram(p)
      if (extension) await new Promise(function (resolve, reject) {
        var timer = 0, start = performance.now()
        function finish(error) { if (timer) clearTimeout(timer); if (signal) signal.removeEventListener('abort', abort); if (error) reject(error); else resolve() }
        function abort() { finish(cancelled()) }
        function poll() {
          try {
            if (signal && signal.aborted) { abort(); return }
            if (gl.isContextLost()) throw Error('QUASAR WebGL2 context lost during compilation')
            if (gl.getProgramParameter(p, extension.COMPLETION_STATUS_KHR)) { finish(); return }
            if (performance.now() - start > 120000) throw Error('QUASAR GPU compilation timed out')
            timer = setTimeout(poll, 16)
          } catch (error) { finish(error) }
        }
        if (signal) signal.addEventListener('abort', abort, { once: true })
        poll()
      })
      if (signal && signal.aborted) throw cancelled()
      owned.forEach(function (s) { if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error('QUASAR shader: ' + gl.getShaderInfoLog(s)) })
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error('QUASAR link: ' + gl.getProgramInfoLog(p) + '; GL=' + gl.getError() + '; lost=' + gl.isContextLost())
      return p
    } catch (error) { gl.deleteProgram(p); throw error }
    finally { owned.forEach(function (s) { gl.deleteShader(s) }) }
  }
  async function create(gl, signal) {
    var sources = shaders(), programs = [], buffers = new Set(), vaos = new Set(), syncs = new Set(), timers = new Map(), disposed = false, generation = 0
    var traceProgram, finishProgram, timerExtension = gl.getExtension('EXT_disjoint_timer_query_webgl2'), timerQueries = new Set()
    try {
      traceProgram = await programAsync(gl, sources.trace, null, ['rawPlane', 'rawInvariant', 'rawMeta'], signal); programs.push(traceProgram)
      finishProgram = await programAsync(gl, sources.finish, null, ['rayGeometry', 'rayAux'], signal); programs.push(finishProgram)
      programs.forEach(function (p) {
        gl.useProgram(p); gl.uniform1ui(gl.getUniformLocation(p, 'arithmeticMask'), 0xffffffff)
        gl.uniform1i(gl.getUniformLocation(p, 'arithmeticComponents'), 6)
        gl.uniform1i(gl.getUniformLocation(p, 'arithmeticStages'), 7)
        gl.uniform1i(gl.getUniformLocation(p, 'eventSteps'), 48)
      })
    } catch (error) { programs.forEach(function (p) { gl.deleteProgram(p) }); throw error }
    function buffer(bytes) { var b = gl.createBuffer(); buffers.add(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_COPY); return b }
    function vao() { var v = gl.createVertexArray(); vaos.add(v); return v }
    function dropBuffer(b) { if (buffers.delete(b)) gl.deleteBuffer(b) }
    function dropVao(v) { if (vaos.delete(v)) gl.deleteVertexArray(v) }
    function check(alive) { if (disposed || (alive && !alive())) { var e = Error('QUASAR GPU build superseded'); e.cancelled = true; throw e } if (gl.isContextLost()) throw Error('QUASAR WebGL2 context lost') }
    function wait(alive) {
      check(alive)
      var fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); syncs.add(fence); gl.flush()
      var start = performance.now()
      return new Promise(function (resolve, reject) {
        function finish(error) { if (syncs.delete(fence)) gl.deleteSync(fence); if (error) reject(error); else resolve() }
        function poll() {
          try {
            check(alive)
            var status = gl.clientWaitSync(fence, 0, 0)
            if (status === gl.WAIT_FAILED) throw Error('QUASAR GPU fence failed')
            if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) { finish(); return }
            if (performance.now() - start > 30000) throw Error('QUASAR GPU build timed out')
            var id = setTimeout(function () { timers.delete(id); poll() }, 0); timers.set(id, function () { finish(Error('QUASAR GPU disposed')) })
          } catch (error) { finish(error) }
        }
        poll()
      })
    }
    function uniformPair(name, value) { var v = pair(value); gl.uniform2f(gl.getUniformLocation(traceProgram, name), v[0], v[1]) }
    async function run(input, alive) {
      var mine = ++generation, original = alive
      alive = function () { return mine === generation && (!original || original()) }
      check(alive)
      var count = input.rays ? input.rays.length : input.columns * input.rows
      var raw = null, result = null, incoming = null, traceVao = null, finishVao = null
      var start = performance.now(), submitMs = 0, diagnostics
      var batchSize = Math.min(2048, Math.max(1, Math.floor(Number(input.batchSize) || 1024)))
      var traceGpuMs = 0, maxTraceBatchGpuMs = 0, timerValid = !!timerExtension, localQueries = []
      try {
        raw = buffer(count * 48); result = buffer(count * 32); traceVao = vao(); gl.bindVertexArray(traceVao)
        if (input.rays) {
          var uv = new Float32Array(count * 4)
          for (var i = 0; i < count; i++) { uv.set(pair(input.rays[i][0]), i * 4); uv.set(pair(input.rays[i][1]), i * 4 + 2) }
          incoming = buffer(uv); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0)
        }
        gl.useProgram(traceProgram)
        var angle = input.angle * Math.PI / 180
        uniformPair('sineAngle', Math.sin(angle)); uniformPair('cosineAngle', Math.cos(angle))
        uniformPair('viewWidth', input.width || 1); uniformPair('viewHeight', input.height || 1)
        uniformPair('cellWidth', input.cellWidth || 1); uniformPair('cellHeight', input.cellHeight || 1)
        uniformPair('shortSide', Math.max(1, Math.min(input.width || 1, input.height || 1)))
        gl.uniform1i(gl.getUniformLocation(traceProgram, 'columns'), input.columns || 1)
        gl.uniform1i(gl.getUniformLocation(traceProgram, 'initialBudget'), (input.budget > 0 ? Math.floor(input.budget) : UniverseGeodesic.budget))
        gl.uniform1i(gl.getUniformLocation(traceProgram, 'explicitRays'), input.rays ? 1 : 0)
        for (var offset = 0; offset < count; offset += batchSize) {
          check(alive)
          var size = Math.min(batchSize, count - offset), now = performance.now()
          var query = timerExtension ? gl.createQuery() : null
          if (query) { timerQueries.add(query); localQueries.push(query); gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, query) }
          gl.useProgram(traceProgram); gl.bindVertexArray(traceVao)
          if (incoming) { gl.bindBuffer(gl.ARRAY_BUFFER, incoming); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, offset * 16) }
          gl.uniform1i(gl.getUniformLocation(traceProgram, 'firstRay'), offset)
          gl.bindBufferRange(gl.TRANSFORM_FEEDBACK_BUFFER, 0, raw, offset * 48, size * 48)
          gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, size); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD)
          gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
          if (query) gl.endQuery(timerExtension.TIME_ELAPSED_EXT)
          submitMs += performance.now() - now
          await wait(alive)
          if (query) {
            if (!gl.getParameter(timerExtension.GPU_DISJOINT_EXT) && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
              var measured = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6
              traceGpuMs += measured; maxTraceBatchGpuMs = Math.max(maxTraceBatchGpuMs, measured)
            } else timerValid = false
            timerQueries.delete(query); gl.deleteQuery(query)
          }
        }
        check(alive)
        finishVao = vao(); gl.bindVertexArray(finishVao); gl.bindBuffer(gl.ARRAY_BUFFER, raw)
        for (var a = 0; a < 3; a++) { gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 4, gl.FLOAT, false, 48, a * 16) }
        gl.useProgram(finishProgram); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, result)
        gl.enable(gl.RASTERIZER_DISCARD); gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, count); gl.endTransformFeedback(); gl.disable(gl.RASTERIZER_DISCARD)
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null)
        await wait(alive); check(alive)
        var data = new Float32Array(count * 8); gl.bindBuffer(gl.ARRAY_BUFFER, result); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, data)
        var errorCode = gl.getError(); if (errorCode !== gl.NO_ERROR) throw Error('QUASAR GPU physics GL error ' + errorCode)
        diagnostics = { state: 'ready', rays: count, exhausted: 0, retried: 0, unresolved: 0, invalid: 0, budget: (input.budget > 0 ? Math.floor(input.budget) : UniverseGeodesic.budget), wallMs: performance.now() - start, submitCpuMs: submitMs, traceGpuMs: timerValid ? traceGpuMs : null, maxTraceBatchGpuMs: timerValid ? maxTraceBatchGpuMs : null, batchSize: batchSize, precision: 'two-float' }
        for (var n = 0; n < count; n++) {
          var terminal = data[n * 8 + 3], valid = terminal === 1 || terminal === 2 || terminal === 3 || terminal === 4
          for (var f = 0; f < 8; f++) if (!Number.isFinite(data[n * 8 + f])) valid = false
          if (!valid) diagnostics.invalid++
          if (terminal === 4) diagnostics.unresolved++
          if (data[n * 8 + 7]) { diagnostics.exhausted++; diagnostics.retried++ }
        }
        if (diagnostics.unresolved || diagnostics.invalid) diagnostics.state = 'failed'
        var rawData = null
        if (input.inspect) { rawData = new Float32Array(count * 12); gl.bindBuffer(gl.ARRAY_BUFFER, raw); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, rawData) }
        var ownedResult = result; result = null
        return { buffer: ownedResult, data: data, rawData: rawData, diagnostics: diagnostics, dispose: function () { dropBuffer(ownedResult) } }
      } finally {
        localQueries.forEach(function (q) { if (timerQueries.delete(q)) gl.deleteQuery(q) })
        gl.disable(gl.RASTERIZER_DISCARD); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null); gl.bindVertexArray(null)
        if (raw) dropBuffer(raw); if (result) dropBuffer(result); if (incoming) dropBuffer(incoming)
        if (traceVao) dropVao(traceVao); if (finishVao) dropVao(finishVao)
      }
    }
    return { run: run, dispose: function () {
      if (disposed) return
      disposed = true
      timers.forEach(function (cancel, id) { clearTimeout(id); cancel() }); timers.clear()
      syncs.forEach(function (s) { gl.deleteSync(s) }); syncs.clear()
      timerQueries.forEach(function (q) { gl.deleteQuery(q) }); timerQueries.clear()
      buffers.forEach(function (b) { gl.deleteBuffer(b) }); buffers.clear()
      vaos.forEach(function (v) { gl.deleteVertexArray(v) }); vaos.clear()
      programs.forEach(function (p) { gl.deleteProgram(p) })
    } }
  }
  return { pair: pair, shaders: shaders, program: program, create: create }
})()
