/** GLSL ES 3.00. u_view = (cx, cy, 2·scale/w, 2·scale/h): data → clip. u_res = (w, h) CSS px. Colours are premultiplied on output; blending is ONE, ONE_MINUS_SRC_ALPHA. */
export const TERRAIN_VS = `#version 300 es
precision highp float;
in vec2 a_pos; in vec4 a_rgba; uniform vec4 u_view; out vec4 v_c;
void main() { gl_Position = vec4((a_pos - u_view.xy) * u_view.zw, 0.0, 1.0); v_c = a_rgba; }`;
export const TERRAIN_FS = `#version 300 es
precision highp float;
in vec4 v_c; uniform float u_alpha; out vec4 o;
void main() { o = v_c * u_alpha; }`;

/** Instanced segments: a unit quad (a_corner.x along 0..1, a_corner.y across −1..1) extruded in screen space; 1-device-pixel feather; sub-pixel widths fold into alpha. */
export const LINE_VS = `#version 300 es
precision highp float;
in vec2 a_corner; in vec2 a_a; in vec2 a_b; in vec4 a_rgba; in float a_w;
uniform vec4 u_view; uniform vec2 u_res; uniform float u_dpr;
out float v_across; out float v_half; out float v_fold; out vec4 v_c;
void main() {
  vec2 h = u_res * 0.5;
  vec2 A = (a_a - u_view.xy) * u_view.zw * h; vec2 B = (a_b - u_view.xy) * u_view.zw * h;
  vec2 d = B - A; float len = max(length(d), 1e-6); vec2 dir = d / len; vec2 n = vec2(-dir.y, dir.x);
  float wDev = a_w * u_dpr; float halfDev = max(wDev, 1.0) * 0.5; float ext = (halfDev + 1.0) / u_dpr;
  vec2 P = A + dir * (a_corner.x * len + (a_corner.x * 2.0 - 1.0) * ext * 0.5) + n * (a_corner.y * ext);
  gl_Position = vec4(P / h, 0.0, 1.0);
  v_across = a_corner.y * (halfDev + 1.0); v_half = halfDev; v_fold = min(wDev, 1.0); v_c = a_rgba;
}`;
export const LINE_FS = `#version 300 es
precision highp float;
in float v_across; in float v_half; in float v_fold; in vec4 v_c; uniform float u_alpha; out vec4 o;
void main() { float cov = clamp(v_half + 0.5 - abs(v_across), 0.0, 1.0); float a = v_c.a * cov * v_fold * u_alpha; o = vec4(v_c.rgb * a, a); }`;

/** Instanced discs: position = mix(from, to, u_t) on the GPU; SDF disc or 2-px ring (u_ring) with a 1-device-pixel feather. */
export const POINT_VS = `#version 300 es
precision highp float;
in vec2 a_corner; in vec2 a_from; in vec2 a_to; in vec4 a_rgba;
uniform vec4 u_view; uniform vec2 u_res; uniform float u_dpr; uniform float u_t; uniform float u_r;
out vec2 v_off; out vec4 v_c;
void main() {
  vec2 h = u_res * 0.5; vec2 pos = mix(a_from, a_to, u_t); vec2 P = (pos - u_view.xy) * u_view.zw * h; float ext = u_r + 1.5; P += a_corner * ext;
  gl_Position = vec4(P / h, 0.0, 1.0); v_off = a_corner * ext * u_dpr; v_c = a_rgba;
}`;
export const POINT_FS = `#version 300 es
precision highp float;
uniform float u_dpr; uniform float u_r; uniform float u_ring; in vec2 v_off; in vec4 v_c; out vec4 o;
void main() {
  float d = length(v_off); float rDev = u_r * u_dpr; float cov;
  if (u_ring > 0.5) cov = clamp(u_dpr - abs(d - rDev) + 0.5, 0.0, 1.0); else cov = clamp(rDev + 0.5 - d, 0.0, 1.0);
  float a = v_c.a * cov; o = vec4(v_c.rgb * a, a);
}`;
