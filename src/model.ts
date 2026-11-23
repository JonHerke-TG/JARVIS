import type { GraphData } from "./data";
import { layoutFullGraph } from "./layout";
import { sampleIndices, DEFAULT_LIMITS, type SampleLimits } from "./sample";

/** Typed-array view of a graph, ready for the GPU. Positions come from layout, never from the data. */
export interface RenderModel {
  nodeCount: number;
  edgeCount: number;
  /** xyz per node, on a shell around radius 1. */
  positions: Float32Array;
  degree: Uint32Array;
  /** 0..1 per node, derived from node type, used to tint within the theme palette. */
  typeMix: Float32Array;
  /** source/target node index per edge (edges with unknown endpoints dropped). */
  ends: Uint32Array;
  sample: { nodes: Uint32Array; edges: Uint32Array };
  timings: Record<string, number>;
}

export function buildRenderModel(graph: GraphData, limits: SampleLimits = DEFAULT_LIMITS): RenderModel {
  const timings: Record<string, number> = {};
  let t = performance.now();
  const lap = (name: string) => { const now = performance.now(); timings[name] = Math.round(now - t); t = now; };

  const n = graph.nodes.length;
  const index = new Map<string, number>();
  const typeIds = new Map<string, number>();
  const typeIdx = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const nd = graph.nodes[i];
    index.set(nd.id, i);
    let ti = typeIds.get(nd.type);
    if (ti === undefined) typeIds.set(nd.type, (ti = typeIds.size));
    typeIdx[i] = ti;
  }
  const typeMix = new Float32Array(n);
  const typeDen = Math.max(typeIds.size - 1, 1);
  for (let i = 0; i < n; i++) typeMix[i] = typeIdx[i] / typeDen;

  const raw = new Uint32Array(graph.edges.length * 2);
  const degree = new Uint32Array(n);
  let m = 0;
  for (const e of graph.edges) {
    const a = index.get(e.source), b = index.get(e.target);
    if (a === undefined || b === undefined) continue;
    raw[m * 2] = a; raw[m * 2 + 1] = b; m++;
    degree[a]++; degree[b]++;
  }
  const ends = m * 2 === raw.length ? raw : raw.slice(0, m * 2);
  lap("index");

  const sample = sampleIndices(n, ends, degree, limits);
  lap("sample");
  const positions = layoutFullGraph(n, ends, degree, sample);
  lap("layout");
  return { nodeCount: n, edgeCount: m, positions, degree, typeMix, ends, sample, timings };
}
