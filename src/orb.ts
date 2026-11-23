import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { RenderModel } from "./model";

export type ThemeName = "cyan" | "gold";
export type ViewMode = "full" | "sampled";

export const THEMES: Record<ThemeName, { primary: number; secondary: number; css: string }> = {
  cyan: { primary: 0x1fb8ff, secondary: 0xc4f7ff, css: "#7fe9ff" },
  gold: { primary: 0xff9a14, secondary: 0xfff0a8, css: "#ffc94d" },
};

const RADIUS = 1.6;
const SAMPLED_ARC_SEGMENTS = 8;
/** Arc resolution for the full view: 4M edges x 4 segments = 32M line vertices per frame. */
const FULL_ARC_SEGMENTS = 4;
/** Width of the node-position texture the full-view edge shader reads from. */
const POS_TEX_WIDTH = 2048;

const NODE_VERT = /* glsl */ `
  attribute float aSize; attribute float aPhase; attribute float aMix;
  uniform float uTime; uniform float uPixelRatio; uniform float uSizeScale;
  varying float vMix; varying float vGlow; varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pulse = 0.5 + 0.5 * sin(uTime * 1.6 + aPhase);
    vGlow = 0.55 + 0.45 * pulse;
    vMix = aMix;
    vDepth = smoothstep(-3.5, 3.5, -mv.z);
    gl_PointSize = max(aSize * uSizeScale * (0.8 + 0.5 * pulse) * uPixelRatio * (6.0 / -mv.z), 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
const NODE_FRAG = /* glsl */ `
  uniform vec3 uPrimary; uniform vec3 uSecondary; uniform float uGain;
  varying float vMix; varying float vGlow; varying float vDepth;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(1.0, 0.0, d);
    float a = (pow(core, 3.0) + 0.25 * core) * vGlow * mix(0.45, 1.0, vDepth);
    gl_FragColor = vec4(mix(uPrimary, uSecondary, vMix * 0.6 + pow(core, 6.0) * 0.5) * a * uGain, 1.0);
  }`;
const EDGE_FRAG = /* glsl */ `
  uniform vec3 uPrimary; uniform vec3 uSecondary; uniform float uGain;
  varying float vA; varying float vDepth;
  void main() {
    gl_FragColor = vec4(mix(uPrimary, uSecondary, clamp(vA / uGain - 0.3, 0.0, 1.0)) * vA * mix(0.3, 1.0, vDepth), 1.0);
  }`;
/** Sampled view: arcs are pre-tessellated on the CPU. */
const SAMPLED_EDGE_VERT = /* glsl */ `
  attribute float aT; attribute float aPhase; attribute float aAlpha;
  uniform float uTime; uniform float uGain;
  varying float vA; varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float wave = pow(0.5 + 0.5 * sin(aT * 6.2831 - uTime * 1.4 + aPhase), 6.0);
    vA = aAlpha * (0.3 + 1.6 * wave) * uGain;
    vDepth = smoothstep(-3.5, 3.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
/**
 * Full view: one instance per edge; the base geometry is a polyline whose position.x is t in [0,1].
 * Endpoints are fetched from a float texture of node positions and the arc is built here.
 */
const FULL_EDGE_VERT = /* glsl */ `
  attribute vec2 aEnds;
  uniform sampler2D uPos; uniform int uTexW;
  uniform float uTime; uniform float uGain; uniform float uRadius;
  varying float vA; varying float vDepth;
  vec3 nodePos(float f) {
    int i = int(f + 0.5);
    return texelFetch(uPos, ivec2(i % uTexW, i / uTexW), 0).xyz;
  }
  void main() {
    float t = position.x;
    vec3 pa = nodePos(aEnds.x), pb = nodePos(aEnds.y);
    float ra = length(pa), rb = length(pb);
    vec3 a = pa / ra, b = pb / rb;
    float ang = acos(clamp(dot(a, b), -0.9999, 0.9999));
    vec3 dir = ang < 1e-3 ? mix(a, b, t) : (sin((1.0 - t) * ang) * a + sin(t * ang) * b) / sin(ang);
    float r = uRadius * mix(ra, rb, t) * (1.0 + 0.08 * min(ang, 1.0) * sin(3.14159 * t));
    vec4 mv = modelViewMatrix * vec4(normalize(dir) * r, 1.0);
    float phase = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453) * 6.2831;
    float wave = pow(0.5 + 0.5 * sin(t * 6.2831 - uTime * 1.4 + phase), 6.0);
    float near = 1.0 / (1.0 + ang * ang * 400.0);
    vA = uGain * near * (0.3 + 1.6 * wave);
    vDepth = smoothstep(-3.5, 3.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

function hash01(i: number, salt: number) {
  let h = Math.imul(i ^ salt, 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export class Orb {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private composer: EffectComposer;
  private group = new THREE.Group();
  private fullView = new THREE.Group();
  private sampledView = new THREE.Group();
  /** Hub backbone edges (the sampled subgraph), also overlaid on the full view. */
  private backbone!: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private uniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: 1 },
    uPrimary: { value: new THREE.Color() },
    uSecondary: { value: new THREE.Color() },
  };
  private velocity = new THREE.Vector2(0.0015, 0.0007);
  private baseSpin = 0.0015;
  private dragging = false;
  private camZ = 6;
  private clock = new THREE.Clock();
  private frames = 0;
  private fpsWindowStart = 0;
  /** Frames per second averaged over the last ~1 s. */
  fps = 0;

  constructor(private container: HTMLElement, model: RenderModel, theme: ThemeName = "cyan", mode: ViewMode = "full") {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x02060a);
    this.camera.position.z = this.camZ;
    this.scene.add(this.group);
    this.group.add(this.fullView, this.sampledView);
    this.group.rotation.x = 0.35;

    this.buildFull(model);
    this.buildSampled(model);
    this.setTheme(theme);
    this.setMode(mode);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.4, 0.2));
    this.composer.addPass(new OutputPass());

    this.bindInput();
    window.addEventListener("resize", this.resize);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  setTheme(name: ThemeName) {
    this.uniforms.uPrimary.value.set(THEMES[name].primary);
    this.uniforms.uSecondary.value.set(THEMES[name].secondary);
  }

  setMode(mode: ViewMode) {
    this.fullView.visible = mode === "full";
    this.sampledView.visible = mode === "sampled";
    if (mode === "full") this.fullView.add(this.backbone);
    else this.sampledView.add(this.backbone);
    this.backbone.material.uniforms.uGain.value = mode === "full" ? 0.45 : 0.9;
  }

  private material(vertexShader: string, fragmentShader: string, extra: Record<string, THREE.IUniform>) {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, ...extra },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  private points(positions: Float32Array, size: Float32Array, phase: Float32Array, mix: Float32Array, sizeScale: number, gain: number) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    g.setAttribute("aMix", new THREE.BufferAttribute(mix, 1));
    const p = new THREE.Points(g, this.material(NODE_VERT, NODE_FRAG, { uSizeScale: { value: sizeScale }, uGain: { value: gain } }));
    p.frustumCulled = false;
    return p;
  }

  private buildFull(model: RenderModel) {
    const n = model.nodeCount;
    const scaled = new Float32Array(n * 3);
    const size = new Float32Array(n), phase = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      scaled[i * 3] = model.positions[i * 3] * RADIUS;
      scaled[i * 3 + 1] = model.positions[i * 3 + 1] * RADIUS;
      scaled[i * 3 + 2] = model.positions[i * 3 + 2] * RADIUS;
      size[i] = 1.2 + Math.min(Math.log2(model.degree[i] + 1), 12) * 1.1;
      phase[i] = hash01(i, 2) * Math.PI * 2;
    }
    this.fullView.add(this.points(scaled, size, phase, model.typeMix, 0.5, 0.012));

    const texH = Math.ceil(n / POS_TEX_WIDTH);
    const texData = new Float32Array(POS_TEX_WIDTH * texH * 4);
    for (let i = 0; i < n; i++) texData.set(model.positions.subarray(i * 3, i * 3 + 3), i * 4);
    const posTex = new THREE.DataTexture(texData, POS_TEX_WIDTH, texH, THREE.RGBAFormat, THREE.FloatType);
    posTex.minFilter = posTex.magFilter = THREE.NearestFilter;
    posTex.needsUpdate = true;

    const base = new Float32Array(FULL_ARC_SEGMENTS * 2 * 3);
    for (let s = 0; s < FULL_ARC_SEGMENTS; s++) {
      base[s * 6] = s / FULL_ARC_SEGMENTS;
      base[s * 6 + 3] = (s + 1) / FULL_ARC_SEGMENTS;
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(base, 3));
    g.setAttribute("aEnds", new THREE.InstancedBufferAttribute(new Float32Array(model.ends), 2));
    g.instanceCount = model.edgeCount;
    const lines = new THREE.LineSegments(
      g,
      this.material(FULL_EDGE_VERT, EDGE_FRAG, {
        uPos: { value: posTex },
        uTexW: { value: POS_TEX_WIDTH },
        uRadius: { value: RADIUS },
        uGain: { value: 0.008 },
      }),
    );
    lines.frustumCulled = false;
    this.fullView.add(lines);
  }

  private buildSampled(model: RenderModel) {
    const { nodes, edges } = model.sample;
    const k = nodes.length;
    const pos = new Float32Array(k * 3), size = new Float32Array(k), phase = new Float32Array(k), mix = new Float32Array(k);
    nodes.forEach((g, i) => {
      for (let c = 0; c < 3; c++) pos[i * 3 + c] = model.positions[g * 3 + c] * RADIUS;
      size[i] = 5 + Math.min(Math.log2(model.degree[g] + 1), 8) * 1.2;
      phase[i] = hash01(g, 2) * Math.PI * 2;
      mix[i] = model.typeMix[g];
    });
    this.sampledView.add(this.points(pos, size, phase, mix, 0.55, 0.9));

    const lines: number[] = [], ts: number[] = [], ph: number[] = [], al: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), v0 = new THREE.Vector3(), v1 = new THREE.Vector3();
    const arc = (t: number, angle: number, out: THREE.Vector3) => {
      out.copy(a).multiplyScalar(Math.sin((1 - t) * angle)).addScaledVector(b, Math.sin(t * angle)).divideScalar(Math.sin(angle));
      return out.normalize().multiplyScalar(RADIUS * (1 + 0.08 * Math.min(angle, 1) * Math.sin(Math.PI * t)));
    };
    for (const e of edges) {
      a.fromArray(model.positions, model.ends[e * 2] * 3).normalize();
      b.fromArray(model.positions, model.ends[e * 2 + 1] * 3).normalize();
      const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -0.9999, 0.9999));
      const alpha = 0.55 / (1 + angle * 1.4);
      const p = hash01(e, 3) * Math.PI * 2;
      for (let s = 0; s < SAMPLED_ARC_SEGMENTS; s++) {
        const t0 = s / SAMPLED_ARC_SEGMENTS, t1 = (s + 1) / SAMPLED_ARC_SEGMENTS;
        arc(t0, angle, v0); arc(t1, angle, v1);
        lines.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z);
        ts.push(t0, t1); ph.push(p, p); al.push(alpha, alpha);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    g.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
    g.setAttribute("aPhase", new THREE.Float32BufferAttribute(ph, 1));
    g.setAttribute("aAlpha", new THREE.Float32BufferAttribute(al, 1));
    this.backbone = new THREE.LineSegments(g, this.material(SAMPLED_EDGE_VERT, EDGE_FRAG, { uGain: { value: 0.9 } }));
  }

  private bindInput() {
    const el = this.renderer.domElement;
    let lx = 0, ly = 0;
    el.addEventListener("pointerdown", (e) => {
      this.dragging = true; lx = e.clientX; ly = e.clientY;
      el.setPointerCapture(e.pointerId);
      this.container.classList.add("dragging");
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      this.velocity.set((e.clientX - lx) * 0.005, (e.clientY - ly) * 0.005);
      this.group.rotation.y += this.velocity.x;
      this.group.rotation.x = THREE.MathUtils.clamp(this.group.rotation.x + this.velocity.y, -1.4, 1.4);
      lx = e.clientX; ly = e.clientY;
    });
    const end = () => { this.dragging = false; this.container.classList.remove("dragging"); };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camZ = THREE.MathUtils.clamp(this.camZ + e.deltaY * 0.004, 3.5, 10);
    }, { passive: false });
  }

  private resize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private tick = () => {
    const t = this.clock.getElapsedTime();
    this.uniforms.uTime.value = t;
    if (!this.dragging) {
      this.group.rotation.y += this.velocity.x;
      this.group.rotation.x = THREE.MathUtils.clamp(this.group.rotation.x + this.velocity.y, -1.4, 1.4);
      this.velocity.x += (this.baseSpin - this.velocity.x) * 0.03;
      this.velocity.y *= 0.95;
    }
    this.group.scale.setScalar(1 + 0.012 * Math.sin(t * 1.1));
    this.camera.position.z += (this.camZ - this.camera.position.z) * 0.08;
    this.composer.render();

    this.frames++;
    if (t - this.fpsWindowStart >= 1) {
      this.fps = this.frames / (t - this.fpsWindowStart);
      this.frames = 0;
      this.fpsWindowStart = t;
    }
  };

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
  }
}
