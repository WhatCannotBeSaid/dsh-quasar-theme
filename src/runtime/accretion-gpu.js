/* Two GPU draws per frame: one point per physical cell to discrete RGBA8 state,
 * then instanced atlas quads. 2D is used only to bake the native font atlas.
 * The physical trace and both frame passes share this canvas's WebGL2 context. */
var UniverseAccretionGPU = (function () {
  var head = '#version 300 es\nprecision highp float;precision highp int;\n'
  function sources() {
    var state = head + [
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
      'int glyph=min(10,int(floor(shown*10.0+0.5))),bucket=min(11,int(shown*12.0));bool luminous=!light||d2<=horizon*horizon;',
      'state=vec4(float(glyph),float(bucket),luminous?1.0:0.0,glyph>0?1.0:0.0)/255.0;}'
    ].join('\n')
    var statePixel = head + 'flat in vec4 state;out vec4 color;void main(){color=state;}'
    var glyph = head + [
      'uniform ivec2 gridSize;uniform vec2 cellSize,viewSize,viewOffset,quadSize;uniform sampler2D stateTexture;',
      'out vec2 uv;flat out int glyphIndex,bucket,luminous,valid;',
      'void main(){int row=gl_InstanceID/gridSize.x,col=gl_InstanceID-row*gridSize.x;ivec4 s=ivec4(floor(texelFetch(stateTexture,ivec2(col,row),0)*255.0+0.5));',
      'glyphIndex=s.x;bucket=s.y;luminous=s.z;valid=s.w;vec2 corner=vec2(0);',
      'if(gl_VertexID==1||gl_VertexID==4||gl_VertexID==5)corner.x=1.0;if(gl_VertexID==2||gl_VertexID==3||gl_VertexID==5)corner.y=1.0;',
      'uv=corner;vec2 xy=(vec2(col,row)+0.5)*cellSize+viewOffset+(corner-0.5)*quadSize;',
      'gl_Position=vec4(xy.x/viewSize.x*2.0-1.0,1.0-xy.y/viewSize.y*2.0,0,1);}'
    ].join('\n')
    var glyphPixel = head + [
      'in vec2 uv;flat in int glyphIndex,bucket,luminous,valid;uniform sampler2D atlas;uniform vec3 darkInk[12],lightInk[12];out vec4 color;',
      'void main(){if(valid==0)discard;float coverage=texture(atlas,vec2((float(glyphIndex)+uv.x)/11.0,uv.y)).a;',
      'vec3 ink=luminous==1?darkInk[bucket]:lightInk[bucket];color=vec4(ink*coverage,coverage);}'
    ].join('\n')
    return { state: state, statePixel: statePixel, glyph: glyph, glyphPixel: glyphPixel }
  }
  function palette(values) {
    var data = new Float32Array(values.length * 3)
    values.forEach(function (s, i) { var n = parseInt(s.slice(1), 16); data[i * 3] = (n >>> 16 & 255) / 255; data[i * 3 + 1] = (n >>> 8 & 255) / 255; data[i * 3 + 2] = (n & 255) / 255 })
    return data
  }
  function create(canvas, glyphs, dark, light) {
    var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, failIfMajorPerformanceCaveat: true })
    if (!gl || typeof gl.createVertexArray !== 'function') throw Error('QUASAR requires hardware WebGL2')
    var programs = [], textures = [], vaos = [], framebuffers = [], queries = [], physics, physicsTask = null, compilation = new AbortController(), grid = null, gridVao = null, disposed = false
    var stateProgram, glyphProgram, stateTexture, atlas, ringTexture, stateFbo, emptyVao, atlasKey = '', ringLength = 0, quadWidth = 0, quadHeight = 0
    var patchA = new Float32Array(96), patchB = new Float32Array(96), frames = 0, gpuMs = null, gpuMax = null, gpuSampleCount = 0, gpuSampleFrame = null
    var extension = gl.getExtension('EXT_disjoint_timer_query_webgl2')
    function texture(filter) {
      var t = gl.createTexture(); textures.push(t); gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return t
    }
    function use(program) { gl.useProgram(program); return function (name) { return gl.getUniformLocation(program, name) } }
    function clear() { if (!disposed && !gl.isContextLost()) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT) } }
    function dispose() {
      if (disposed) return
      compilation.abort()
      if (grid) { grid.dispose(); grid = null }
      if (physics) physics.dispose()
      queries.forEach(function (sample) { gl.deleteQuery(sample.query) }); queries = []
      textures.forEach(function (t) { gl.deleteTexture(t) }); framebuffers.forEach(function (f) { gl.deleteFramebuffer(f) })
      vaos.forEach(function (v) { gl.deleteVertexArray(v) }); programs.forEach(function (p) { gl.deleteProgram(p) })
      clear(); disposed = true
    }
    try {
      var shader = sources()
      stateProgram = UniverseGeodesicGPU.program(gl, shader.state, shader.statePixel); programs.push(stateProgram)
      glyphProgram = UniverseGeodesicGPU.program(gl, shader.glyph, shader.glyphPixel); programs.push(glyphProgram)
      stateTexture = texture(gl.NEAREST); atlas = texture(gl.LINEAR); ringTexture = texture(gl.NEAREST)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array(1)); ringLength = 1
      stateFbo = gl.createFramebuffer(); framebuffers.push(stateFbo)
      emptyVao = gl.createVertexArray(); vaos.push(emptyVao)
      var ink = use(glyphProgram); gl.uniform1i(ink('stateTexture'), 0); gl.uniform1i(ink('atlas'), 1)
      gl.uniform3fv(ink('darkInk[0]'), palette(dark)); gl.uniform3fv(ink('lightInk[0]'), palette(light))
      var stateInk = use(stateProgram); gl.uniform1i(stateInk('ringEdge'), 0)
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER)
    } catch (error) { dispose(); throw error }
    function bakeAtlas(size) {
      var key = [size.cw, size.ch, size.dpr, glyphs].join(':')
      if (key === atlasKey) return
      var tileW = Math.ceil(size.cw * size.dpr) + 4, tileH = Math.ceil(size.ch * size.dpr) + 4
      var source = document.createElement('canvas'); source.width = tileW * glyphs.length; source.height = tileH
      var ctx = source.getContext('2d', { alpha: true }); if (!ctx) throw Error('QUASAR font atlas unavailable')
      ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0)
      ctx.font = '600 ' + Math.round(size.ch * .95) + 'px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff'
      for (var i = 0; i < glyphs.length; i++) ctx.fillText(glyphs.charAt(i), (i + .5) * tileW / size.dpr, tileH / (2 * size.dpr), size.cw)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      quadWidth = tileW / size.dpr; quadHeight = tileH / size.dpr; atlasKey = key
    }
    function setGrid(result, size) {
      if (disposed) { result.dispose(); return }
      if (grid) grid.dispose()
      if (gridVao) { gl.deleteVertexArray(gridVao); vaos.splice(vaos.indexOf(gridVao), 1) }
      grid = result; gridVao = gl.createVertexArray(); vaos.push(gridVao); gl.bindVertexArray(gridVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, grid.buffer); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, grid.stride || 32, 0); gl.bindVertexArray(null)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stateTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size.cols, size.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, stateTexture, 0)
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('QUASAR character state framebuffer incomplete')
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); bakeAtlas(size)
    }
    function pollTimers() {
      if (!extension || !queries.length) return
      if (gl.getParameter(extension.GPU_DISJOINT_EXT)) { queries.forEach(function (sample) { gl.deleteQuery(sample.query) }); queries = []; return }
      while (queries.length && gl.getQueryParameter(queries[0].query, gl.QUERY_RESULT_AVAILABLE)) {
        var sample = queries.shift(), q = sample.query, value = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q)
        if (Number.isFinite(value)) { gpuMs = value; gpuMax = Math.max(gpuMax || 0, value); gpuSampleCount++; gpuSampleFrame = sample.frame }
      }
    }
    function draw(size, frame) {
      if (disposed || !grid || gl.isContextLost()) return
      pollTimers()
      var sampleFrame = frames, query = extension && frames % 30 === 0 && queries.length < 3 ? gl.createQuery() : null
      if (query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query)
      try {
        var edge = frame.ring && frame.ring.edge, bins = edge ? edge.length : 0
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ringTexture)
        if (bins) {
          if (bins > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw Error('QUASAR ring envelope exceeds texture limit')
          var pixels = edge instanceof Float32Array ? edge : new Float32Array(edge)
          if (ringLength !== bins) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, bins, 1, 0, gl.RED, gl.FLOAT, pixels); ringLength = bins }
          else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, bins, 1, gl.RED, gl.FLOAT, pixels)
        }
        for (var p = 0; p < 24; p++) { var patch = frame.patches[p], n = p * 4; patchA[n] = patch.radius; patchA[n + 1] = patch.phi; patchA[n + 2] = patch.age; patchA[n + 3] = patch.radial; patchB[n] = patch.angular; patchB[n + 1] = patch.amplitude }
        var loc = use(stateProgram), scale = frame.ring ? frame.horizon / frame.ring.horizon : 1, padding = Math.sqrt(size.cw * size.cw + size.ch * size.ch) / 2 + 1
        gl.uniform2i(loc('gridSize'), size.cols, size.rows); gl.uniform2f(loc('cellSize'), size.cw, size.ch); gl.uniform2f(loc('base'), frame.baseX, frame.baseY)
        gl.uniform1f(loc('horizon'), frame.horizon); gl.uniform1f(loc('brightness'), frame.brightness); gl.uniform1i(loc('light'), frame.light ? 1 : 0)
        gl.uniform1i(loc('ringBins'), bins); gl.uniform1f(loc('ringScale'), scale); gl.uniform1f(loc('ringClear'), padding); gl.uniform1f(loc('ringOuter'), bins ? frame.ring.edgeMax * scale + padding : 0)
        gl.uniform4fv(loc('patchA[0]'), patchA); gl.uniform4fv(loc('patchB[0]'), patchB)
        gl.disable(gl.BLEND); gl.bindFramebuffer(gl.FRAMEBUFFER, stateFbo); gl.viewport(0, 0, size.cols, size.rows); gl.bindVertexArray(gridVao); gl.drawArrays(gl.POINTS, 0, size.cols * size.rows)
        clear(); loc = use(glyphProgram); gl.uniform2i(loc('gridSize'), size.cols, size.rows); gl.uniform2f(loc('cellSize'), size.cw, size.ch)
        gl.uniform2f(loc('viewSize'), size.w, size.h); gl.uniform2f(loc('viewOffset'), frame.viewX, frame.viewY); gl.uniform2f(loc('quadSize'), quadWidth, quadHeight)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stateTexture); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas)
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.bindVertexArray(emptyVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, size.cols * size.rows)
        gl.bindVertexArray(null); frames++
      } finally { if (query) { gl.endQuery(extension.TIME_ELAPSED_EXT); queries.push({ query: query, frame: sampleFrame }) } }
    }
    return { gl: gl, clear: clear, setGrid: setGrid, draw: draw,
      build: async function (input, alive) {
        if (!physicsTask) physicsTask = UniverseGeodesicGPU.create(gl, compilation.signal).then(function (engine) {
          if (disposed) { engine.dispose(); var error = Error('QUASAR GPU compilation disposed'); error.cancelled = true; throw error }
          physics = engine; return engine
        })
        var engine = await physicsTask
        if (disposed || (alive && !alive())) { var error = Error('QUASAR GPU build superseded'); error.cancelled = true; throw error }
        return engine.run(input, alive)
      },
      stats: function () { return { backend: 'webgl2', frameGpuMs: gpuMs, maxFrameGpuMs: gpuMax, frameGpuSampleCount: gpuSampleCount, frameGpuSampleFrame: gpuSampleFrame, frames: frames, timerAvailable: !!extension } },
      invalidateAtlas: function () { atlasKey = '' }, refreshAtlas: bakeAtlas, dispose: dispose }
  }
  return { create: create, sources: sources }
})()
