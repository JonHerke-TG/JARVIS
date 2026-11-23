import { createDataSource } from "./data";
import { sampleGraph } from "./sample";
import { Orb, THEMES, type ThemeName } from "./orb";

const app = document.getElementById("app")!;
const button = document.getElementById("theme") as HTMLButtonElement;

let theme: ThemeName = (localStorage.getItem("jarvis-theme") as ThemeName) in THEMES
  ? (localStorage.getItem("jarvis-theme") as ThemeName)
  : "cyan";
let orb: Orb | undefined;

function applyTheme(name: ThemeName) {
  theme = name;
  localStorage.setItem("jarvis-theme", name);
  document.documentElement.style.setProperty("--accent", THEMES[name].css);
  button.textContent = `Theme: ${name}`;
  orb?.setTheme(name);
}
const toggle = () => applyTheme(theme === "cyan" ? "gold" : "cyan");
button.addEventListener("click", toggle);
window.addEventListener("keydown", (e) => e.key.toLowerCase() === "t" && toggle());
applyTheme(theme);

const caption = document.getElementById("caption")!;
const stats = document.getElementById("stats")!;
const fmt = (n: number) => n.toLocaleString("en-US");

async function boot() {
  caption.textContent = "Loading graph\u2026";
  await new Promise((r) => setTimeout(r, 50));
  const t0 = performance.now();
  const graph = await createDataSource().getGraph();
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  const drawn = sampleGraph(graph);
  const sampleMs = performance.now() - t1;
  orb = new Orb(app, drawn, theme);
  caption.textContent = "How may I help, sir?";
  stats.textContent = `${fmt(graph.nodes.length)} nodes \u00b7 ${fmt(graph.edges.length)} edges loaded \u00b7 showing ${fmt(drawn.nodes.length)} / ${fmt(drawn.edges.length)}`;
  console.info(`graph loaded in ${loadMs.toFixed(0)} ms, sampled in ${sampleMs.toFixed(0)} ms`, { nodes: graph.nodes.length, edges: graph.edges.length, drawnNodes: drawn.nodes.length, drawnEdges: drawn.edges.length });
  (window as unknown as { __jarvis: object }).__jarvis = { loadMs, sampleMs, nodes: graph.nodes.length, edges: graph.edges.length, drawnNodes: drawn.nodes.length, drawnEdges: drawn.edges.length };
}

boot().catch((err) => {
  console.error(err);
  caption.textContent = "Unable to reach the graph, sir.";
});
