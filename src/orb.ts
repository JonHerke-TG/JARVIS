import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { GraphData } from "./data";
import { layoutOnSphere } from "./layout";

export type ThemeName = "cyan" | "gold";

export const THEMES: Record<ThemeName, { primary: number; secondary: number; css: string }> = {
  cyan: { primary: 0x1fb8ff, secondary: 0xc4f7ff, css: "#7fe9ff" },
  gold: { primary: 0xff9a14, secondary: 0xfff0a8, css: "#ffc94d" },
};

const RADIUS = 1.6;
const ARC_SEGMENTS = 8;

const NODE_VERT = /* glsl */ `
  attribute float aSize; attribute float aPhase; attribute float aMix;
  uniform float uTime; uniform float uPixelRatio;
  varying float vMix; varying float vGlow; varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float pulse = 0.5 + 0.5 * sin(uTime * 1.6 + aPhase);
    vGlow = 0.55 + 0.45 * pulse;
    vMix = aMix;
    vDepth = smoothstep(-3.5, 3.5, -mv.z) ;
    gl_PointSize = aSize * 0.55 * (0.8 + 0.5 * pulse) * uPixelRatio * (6.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const NODE_FRAG = /* glsl */ `
  uniform vec3 uPrimary; uniform vec3 uSecondary;
  varying float vMix; varying float vGlow; varying float vDepth;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = smoothstep(1.0, 0.0, d);
    float a = (pow(core, 3.0) + 0.25 * core) * vGlow * mix(0.45, 1.0, vDepth);
    gl_FragColor = vec4(mix(uPrimary, uSecondary, vMix * 0.6 + pow(core, 6.0) * 0.5) * a * 0.9, 1.0);
  }`;
const EDGE_VERT = /* glsl */ `
  attribute float aT; attribute float aPhase; attribute float aAlpha;
  uniform float uTime;
  varying float vA; varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float wave = pow(0.5 + 0.5 * sin(aT * 6.2831 - uTime * 1.4 + aPhase), 6.0);
    vA = aAlpha * (0.3 + 1.6 * wave);
    vDepth = smoothstep(-3.5, 3.5, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const EDGE_FRAG = /* glsl */ `
  uniform vec3 uPrimary; uniform vec3 uSecondary;
  varying float vA; varying float vDepth;
  void main() {
    gl_FragColor = vec4(mix(uPrimary, uSecondary, clamp(vA - 0.3, 0.0, 1.0)) * vA * mix(0.3, 1.0, vDepth) * 0.9, 1.0);
  }`;

function hash01(s: string, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

export class Orb {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  private composer: EffectComposer;
  private group = new THREE.Group();
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

  constructor(private container: HTMLElement, graph: GraphData, theme: ThemeName = "cyan") {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.uniforms.uPixelRatio.value = this.renderer.getPixelRatio();
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x02060a);
    this.camera.position.z = this.camZ;
    this.scene.add(this.group);
    this.group.rotation.x = 0.35;

    this.buildGraph(graph);
    this.setTheme(theme);

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

  private buildGraph(graph: GraphData) {
    const pos = layoutOnSphere(graph);
    const n = graph.nodes.length;
    const index = new Map(graph.nodes.map((nd, i) => [nd.id, i]));
    const types = [...new Set(graph.nodes.map((nd) => nd.type))];

    const nodePos = new Float32Array(n * 3);
    const size = new Float32Array(n), phase = new Float32Array(n), mix = new Float32Array(n);
    const degree = new Uint16Array(n);
    for (const e of graph.edges) {
      const a = index.get(e.source), b = index.get(e.target);
      if (a !== undefined && b !== undefined) { degree[a]++; degree[b]++; }
    }
    for (let i = 0; i < n; i++) {
      const r = RADIUS * (1 + (hash01(graph.nodes[i].id, 1) - 0.5) * 0.06);
      for (let k = 0; k < 3; k++) nodePos[i * 3 + k] = pos[i * 3 + k] * r;
      size[i] = 5 + Math.min(degree[i], 8) * 1.6;
      phase[i] = hash01(graph.nodes[i].id, 2) * Math.PI * 2;
      mix[i] = types.indexOf(graph.nodes[i].type) / Math.max(types.length - 1, 1);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(nodePos, 3));
    pg.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    pg.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    pg.setAttribute("aMix", new THREE.BufferAttribute(mix, 1));
    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
    this.group.add(
      new THREE.Points(pg, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: NODE_VERT, fragmentShader: NODE_FRAG, ...additive })),
    );

    // Edges are great-circle arcs that bulge outward, so they hug the shell like the reference globe.
    const lines: number[] = [], ts: number[] = [], ph: number[] = [], al: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), v0 = new THREE.Vector3(), v1 = new THREE.Vector3();
    const arc = (t: number, angle: number, out: THREE.Vector3) => {
      out.copy(a).multiplyScalar(Math.sin((1 - t) * angle)).addScaledVector(b, Math.sin(t * angle)).divideScalar(Math.sin(angle));
      return out.normalize().multiplyScalar(RADIUS * (1 + 0.08 * Math.min(angle, 1) * Math.sin(Math.PI * t)));
    };
    for (const e of graph.edges) {
      const ia = index.get(e.source), ib = index.get(e.target);
      if (ia === undefined || ib === undefined) continue;
      a.fromArray(pos, ia * 3); b.fromArray(pos, ib * 3);
      const angle = Math.acos(THREE.MathUtils.clamp(a.dot(b), -0.9999, 0.9999));
      const alpha = 0.55 / (1 + angle * 1.4);
      const p = hash01(e.source + e.target, 3) * Math.PI * 2;
      for (let s = 0; s < ARC_SEGMENTS; s++) {
        const t0 = s / ARC_SEGMENTS, t1 = (s + 1) / ARC_SEGMENTS;
        arc(t0, angle, v0); arc(t1, angle, v1);
        lines.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z);
        ts.push(t0, t1); ph.push(p, p); al.push(alpha, alpha);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
    lg.setAttribute("aT", new THREE.Float32BufferAttribute(ts, 1));
    lg.setAttribute("aPhase", new THREE.Float32BufferAttribute(ph, 1));
    lg.setAttribute("aAlpha", new THREE.Float32BufferAttribute(al, 1));
    this.group.add(
      new THREE.LineSegments(lg, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG, ...additive })),
    );
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
  };

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
  }
}
