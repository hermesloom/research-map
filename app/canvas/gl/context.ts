export type GL = WebGL2RenderingContext;
export type Program = { prog: WebGLProgram; attr: Record<string, number>; uni: Record<string, WebGLUniformLocation | null> };

export function createGL(canvas: HTMLCanvasElement): GL | null {
  try { return canvas.getContext("webgl2", { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: "high-performance", depth: false, stencil: false }) as GL | null; } catch { return null; }
}
function compile(gl: GL, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(`shader: ${log}`); }
  return s;
}
export function buildProgram(gl: GL, vs: string, fs: string, attrs: string[], unis: string[]): Program {
  const prog = gl.createProgram()!; const v = compile(gl, gl.VERTEX_SHADER, vs), f = compile(gl, gl.FRAGMENT_SHADER, fs); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog); gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) { const log = gl.getProgramInfoLog(prog); gl.deleteProgram(prog); throw new Error(`program: ${log}`); }
  const attr: Record<string, number> = {}, uni: Record<string, WebGLUniformLocation | null> = {};
  for (const a of attrs) attr[a] = gl.getAttribLocation(prog, a); for (const u of unis) uni[u] = gl.getUniformLocation(prog, u);
  return { prog, attr, uni };
}
export function buffer(gl: GL, target: number, data: ArrayBufferView, usage = gl.STATIC_DRAW): WebGLBuffer { const b = gl.createBuffer()!; gl.bindBuffer(target, b); gl.bufferData(target, data, usage); return b; }
