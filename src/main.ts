import { createDataSource } from "./data";
import { buildRenderModel, type RenderModel } from "./model";
import { Orb, THEMES, type ThemeName, type ViewMode } from "./orb";

const app = document.getElementById("app")!;
const themeButton = document.getElementById("theme") as HTMLButtonElement;
const viewButton = document.getElementById("view") as HTMLButtonElement;
const caption = document.getElementById("caption")!;
const stats = document.getElementById("stats")!;
const fmt = (n: number) => n.toLocaleString("en-US");

const stored = localStorage.getItem("jarvis-theme") as ThemeName;
let theme: ThemeName = stored in THEMES ? stored : "cyan";
let mode: ViewMode = new URLSearchParams(location.search).get("view") === "sampled" ? "sampled" : "full";
let orb: Orb | undefined;
let model: RenderModel | undefined;

function applyTheme(name: ThemeName) {
  theme = name;
  localStorage.setItem("jarvis-theme", name);
  document.documentElement.style.setProperty("--accent", THEMES[name].css);
  themeButton.textContent = `Theme: ${name}`;
  orb?.setTheme(name);
}

function applyMode(next: ViewMode) {
  mode = next;
  viewButton.textContent = `View: ${next}`;
  orb?.setMode(next);
  renderStats();
}

function renderStats() {
  if (!model) return;
  const drawnNodes = mode === "full" ? model.nodeCount : model.sample.nodes.length;
  const drawnEdges = mode === "full" ? model.edgeCount : model.sample.edges.length;
  const fps = orb?.fps ? ` \u00b7 ${orb.fps.toFixed(orb.fps < 10 ? 2 : 0)} fps` : "";
  stats.textContent = `drawing ${fmt(drawnNodes)} nodes / ${fmt(drawnEdges)} edges of ${fmt(model.nodeCount)} / ${fmt(model.edgeCount)} loaded (${mode})${fps}`;
}

themeButton.addEventListener("click", () => applyTheme(theme === "cyan" ? "gold" : "cyan"));
viewButton.addEventListener("click", () => applyMode(mode === "full" ? "sampled" : "full"));
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "t") applyTheme(theme === "cyan" ? "gold" : "cyan");
  if (key === "s") applyMode(mode === "full" ? "sampled" : "full");
});
applyTheme(theme);
applyMode(mode);

async function boot() {
  caption.textContent = "Loading graph\u2026";
  await new Promise((r) => setTimeout(r, 50));
  const t0 = performance.now();
  const graph = await createDataSource().getGraph();
  const loadMs = performance.now() - t0;
  model = buildRenderModel(graph);
  orb = new Orb(app, model, theme, mode);
  await new Promise((r) => requestAnimationFrame(r));
  const readyMs = performance.now() - t0;
  caption.textContent = "How may I help, sir?";
  renderStats();
  setInterval(renderStats, 1000);
  const report = { loadMs: Math.round(loadMs), ...model.timings, readyMs: Math.round(readyMs), nodes: model.nodeCount, edges: model.edgeCount };
  console.info("jarvis boot", report);
  Object.assign(window, { __jarvis: { ...report, orb, fps: () => orb?.fps ?? 0, setMode: applyMode } });
}

boot().catch((err) => {
  console.error(err);
  caption.textContent = "Unable to reach the graph, sir.";
});
