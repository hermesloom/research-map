import { buildProgram, buffer, type GL, type Program } from "./context";
import { TERRAIN_VS, TERRAIN_FS, LINE_VS, LINE_FS, POINT_VS, POINT_FS } from "./shaders";
import type { TerrainMesh } from "../terrain/types";

export type View = { view: [number, number, number, number]; res: [number, number]; dpr: number };
export class Programs {
  terrain: Program; line: Program; point: Program; lineQuad: WebGLBuffer; pointQuad: WebGLBuffer;
  constructor(public gl: GL) {
    this.terrain = buildProgram(gl, TERRAIN_VS, TERRAIN_FS, ["a_pos", "a_rgba"], ["u_view", "u_alpha"]);
    this.line = buildProgram(gl, LINE_VS, LINE_FS, ["a_corner", "a_a", "a_b", "a_rgba", "a_w"], ["u_view", "u_res", "u_dpr", "u_alpha"]);
    this.point = buildProgram(gl, POINT_VS, POINT_FS, ["a_corner", "a_from", "a_to", "a_rgba"], ["u_view", "u_res", "u_dpr", "u_t", "u_r", "u_ring", "u_ringColor"]);
    this.lineQuad = buffer(gl, gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]));
    this.pointQuad = buffer(gl, gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));
  }
  dispose() { const gl = this.gl; gl.deleteProgram(this.terrain.prog); gl.deleteProgram(this.line.prog); gl.deleteProgram(this.point.prog); gl.deleteBuffer(this.lineQuad); gl.deleteBuffer(this.pointQuad); }
}

/** One uploaded terrain mesh: band triangles (VAO + IBO) and contour segments (instanced). Two draw calls. */
export class TerrainLayer {
  private fillVao: WebGLVertexArrayObject; private lineVao: WebGLVertexArrayObject; private bufs: WebGLBuffer[] = []; readonly triCount: number; readonly segCount: number;
  constructor(private P: Programs, readonly mesh: TerrainMesh) {
    const gl = P.gl; this.triCount = mesh.triCount; this.segCount = mesh.segmentCount;
    this.fillVao = gl.createVertexArray()!; gl.bindVertexArray(this.fillVao);
    const pos = buffer(gl, gl.ARRAY_BUFFER, mesh.positions); gl.enableVertexAttribArray(P.terrain.attr.a_pos); gl.vertexAttribPointer(P.terrain.attr.a_pos, 2, gl.FLOAT, false, 0, 0);
    const col = buffer(gl, gl.ARRAY_BUFFER, mesh.colors); gl.enableVertexAttribArray(P.terrain.attr.a_rgba); gl.vertexAttribPointer(P.terrain.attr.a_rgba, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    const ibo = buffer(gl, gl.ELEMENT_ARRAY_BUFFER, mesh.indices); gl.bindVertexArray(null);
    this.lineVao = gl.createVertexArray()!; gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.lineQuad); gl.enableVertexAttribArray(P.line.attr.a_corner); gl.vertexAttribPointer(P.line.attr.a_corner, 2, gl.FLOAT, false, 0, 0);
    const seg = buffer(gl, gl.ARRAY_BUFFER, mesh.lines); gl.enableVertexAttribArray(P.line.attr.a_a); gl.vertexAttribPointer(P.line.attr.a_a, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(P.line.attr.a_a, 1);
    gl.enableVertexAttribArray(P.line.attr.a_b); gl.vertexAttribPointer(P.line.attr.a_b, 2, gl.FLOAT, false, 16, 8); gl.vertexAttribDivisor(P.line.attr.a_b, 1);
    const lc = buffer(gl, gl.ARRAY_BUFFER, mesh.lineColors); gl.enableVertexAttribArray(P.line.attr.a_rgba); gl.vertexAttribPointer(P.line.attr.a_rgba, 4, gl.UNSIGNED_BYTE, true, 0, 0); gl.vertexAttribDivisor(P.line.attr.a_rgba, 1);
    const lw = buffer(gl, gl.ARRAY_BUFFER, mesh.lineWidths); gl.enableVertexAttribArray(P.line.attr.a_w); gl.vertexAttribPointer(P.line.attr.a_w, 1, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(P.line.attr.a_w, 1);
    gl.bindVertexArray(null); this.bufs.push(pos, col, ibo, seg, lc, lw);
  }
  drawFill(v: View, alpha: number): number {
    if (this.triCount === 0 || alpha <= 0) return 0; const gl = this.P.gl, p = this.P.terrain; gl.useProgram(p.prog); gl.uniform4fv(p.uni.u_view, v.view); gl.uniform1f(p.uni.u_alpha, alpha);
    gl.bindVertexArray(this.fillVao); gl.drawElements(gl.TRIANGLES, this.triCount * 3, gl.UNSIGNED_INT, 0); gl.bindVertexArray(null); return 1;
  }
  drawLines(v: View, alpha: number): number {
    if (this.segCount === 0 || alpha <= 0) return 0; const gl = this.P.gl, p = this.P.line; gl.useProgram(p.prog); gl.uniform4fv(p.uni.u_view, v.view); gl.uniform2fv(p.uni.u_res, v.res); gl.uniform1f(p.uni.u_dpr, v.dpr); gl.uniform1f(p.uni.u_alpha, alpha);
    gl.bindVertexArray(this.lineVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.segCount); gl.bindVertexArray(null); return 1;
  }
  dispose() { const gl = this.P.gl; gl.deleteVertexArray(this.fillVao); gl.deleteVertexArray(this.lineVao); for (const b of this.bufs) gl.deleteBuffer(b); }
}

/** All points as instanced discs; from/to buffers for the GPU tween; the selection ring re-uses the row's attributes. */
export class PointLayer {
  private vao: WebGLVertexArrayObject; private ringVao: WebGLVertexArrayObject; private fromBuf: WebGLBuffer; private toBuf: WebGLBuffer; private colBuf: WebGLBuffer; count = 0;
  constructor(private P: Programs) {
    const gl = P.gl; this.fromBuf = gl.createBuffer()!; this.toBuf = gl.createBuffer()!; this.colBuf = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!; this.ringVao = gl.createVertexArray()!; this.bind(this.vao, 0);
  }
  private bind(vao: WebGLVertexArrayObject, row: number) {
    const gl = this.P.gl, p = this.P.point; gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.P.pointQuad); gl.enableVertexAttribArray(p.attr.a_corner); gl.vertexAttribPointer(p.attr.a_corner, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fromBuf); gl.enableVertexAttribArray(p.attr.a_from); gl.vertexAttribPointer(p.attr.a_from, 2, gl.FLOAT, false, 0, row * 8); gl.vertexAttribDivisor(p.attr.a_from, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.toBuf); gl.enableVertexAttribArray(p.attr.a_to); gl.vertexAttribPointer(p.attr.a_to, 2, gl.FLOAT, false, 0, row * 8); gl.vertexAttribDivisor(p.attr.a_to, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf); gl.enableVertexAttribArray(p.attr.a_rgba); gl.vertexAttribPointer(p.attr.a_rgba, 4, gl.UNSIGNED_BYTE, true, 0, row * 4); gl.vertexAttribDivisor(p.attr.a_rgba, 1);
    gl.bindVertexArray(null);
  }
  /** Interleave x/y into one Float32Array (x0, y0, x1, y1, …). */
  static interleave(x: Float32Array, y: Float32Array, out?: Float32Array): Float32Array { const o = out && out.length === x.length * 2 ? out : new Float32Array(x.length * 2); for (let i = 0; i < x.length; i++) { o[2 * i] = x[i]; o[2 * i + 1] = y[i]; } return o; }
  setColors(rgba: Uint8Array) { const gl = this.P.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf); gl.bufferData(gl.ARRAY_BUFFER, rgba, gl.STATIC_DRAW); this.count = rgba.length / 4; }
  setFrom(xy: Float32Array) { const gl = this.P.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.fromBuf); gl.bufferData(gl.ARRAY_BUFFER, xy, gl.DYNAMIC_DRAW); }
  setTo(xy: Float32Array) { const gl = this.P.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.toBuf); gl.bufferData(gl.ARRAY_BUFFER, xy, gl.DYNAMIC_DRAW); }
  draw(v: View, t: number, radius: number): number {
    if (this.count === 0) return 0; const gl = this.P.gl, p = this.P.point; gl.useProgram(p.prog); gl.uniform4fv(p.uni.u_view, v.view); gl.uniform2fv(p.uni.u_res, v.res); gl.uniform1f(p.uni.u_dpr, v.dpr); gl.uniform1f(p.uni.u_t, t); gl.uniform1f(p.uni.u_r, radius); gl.uniform1f(p.uni.u_ring, 0);
    gl.bindVertexArray(this.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count); gl.bindVertexArray(null); return 1;
  }
  drawRing(v: View, t: number, row: number, radius: number): number {
    if (row < 0 || row >= this.count) return 0; const gl = this.P.gl, p = this.P.point; this.bind(this.ringVao, row);
    gl.useProgram(p.prog); gl.uniform4fv(p.uni.u_view, v.view); gl.uniform2fv(p.uni.u_res, v.res); gl.uniform1f(p.uni.u_dpr, v.dpr); gl.uniform1f(p.uni.u_t, t); gl.uniform1f(p.uni.u_r, radius + 9); gl.uniform1f(p.uni.u_ring, 1); gl.uniform4f(p.uni.u_ringColor, 156 / 255, 196 / 255, 1, 1);
    gl.bindVertexArray(this.ringVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1); gl.bindVertexArray(null); return 1;
  }
  dispose() { const gl = this.P.gl; gl.deleteVertexArray(this.vao); gl.deleteVertexArray(this.ringVao); gl.deleteBuffer(this.fromBuf); gl.deleteBuffer(this.toBuf); gl.deleteBuffer(this.colBuf); }
}
