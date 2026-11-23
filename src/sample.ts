import type { GraphData } from "./data";

export interface SampleLimits {
  maxNodes: number;
  maxEdges: number;
}

export const DEFAULT_LIMITS: SampleLimits = { maxNodes: 1600, maxEdges: 3600 };

/**
 * Picks the connected, hub-centred subgraph that is actually drawn; the full graph stays loaded.
 * Deterministic: seeds with the highest-degree nodes, then grows through incident edges in
 * data order until the node cap is hit, and keeps edges whose endpoints both survived.
 */
export function sampleGraph(graph: GraphData, { maxNodes, maxEdges }: SampleLimits = DEFAULT_LIMITS): GraphData {
  if (graph.nodes.length <= maxNodes && graph.edges.length <= maxEdges) return graph;

  const index = new Map<string, number>();
  graph.nodes.forEach((n, i) => index.set(n.id, i));
  const n = graph.nodes.length;
  const degree = new Uint32Array(n);
  const ends = new Int32Array(graph.edges.length * 2).fill(-1);
  graph.edges.forEach((e, k) => {
    const a = index.get(e.source), b = index.get(e.target);
    if (a === undefined || b === undefined) return;
    ends[k * 2] = a; ends[k * 2 + 1] = b;
    degree[a]++; degree[b]++;
  });

  // Counting sort by degree to find the top hubs without sorting 1M+ entries.
  const maxDeg = degree.reduce((m, d) => (d > m ? d : m), 0);
  const histogram = new Uint32Array(maxDeg + 1);
  for (let i = 0; i < n; i++) histogram[degree[i]]++;
  const seedCount = Math.floor(maxNodes * 0.35);
  let threshold = maxDeg, taken = 0;
  while (threshold > 0 && taken + histogram[threshold] <= seedCount) taken += histogram[threshold--];

  const selected = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n && count < seedCount; i++) if (degree[i] > threshold) { selected[i] = 1; count++; }

  for (let k = 0; k < graph.edges.length && count < maxNodes; k++) {
    const a = ends[k * 2], b = ends[k * 2 + 1];
    if (a < 0) continue;
    if (selected[a] && !selected[b]) { selected[b] = 1; count++; }
    else if (selected[b] && !selected[a]) { selected[a] = 1; count++; }
  }

  const nodes = graph.nodes.filter((_, i) => selected[i]);
  const edges = [];
  for (let k = 0; k < graph.edges.length && edges.length < maxEdges; k++) {
    const a = ends[k * 2], b = ends[k * 2 + 1];
    if (a >= 0 && selected[a] && selected[b]) edges.push(graph.edges[k]);
  }
  return { nodes, edges };
}
