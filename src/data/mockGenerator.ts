import type { GraphData, GraphEdge, GraphNode } from "./types";

export const MOCK_SEED = 1138;
export const MOCK_NODE_COUNT = 1_200_000;
export const MOCK_EDGE_COUNT = 4_000_000;

const TYPES = ["Person", "Company", "Account", "Device", "Document", "Location"];
const CUMULATIVE_WEIGHTS = [0.3, 0.42, 0.62, 0.78, 0.92, 1];
const EDGE_TYPES: string[][] = [
  ["KNOWS", "WORKS_AT", "OWNS"],
  ["PARTNER_OF", "LOCATED_IN"],
  ["TRANSFERS_TO", "OWNED_BY"],
  ["USED_BY", "SEEN_AT"],
  ["MENTIONS", "AUTHORED_BY"],
  ["NEAR"],
];

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MockOptions {
  seed?: number;
  nodes?: number;
  edges?: number;
}

/**
 * Deterministic synthetic graph. Edge targets follow preferential attachment
 * (half the time an endpoint of an earlier edge is reused), giving the heavy-tailed
 * degree distribution of real networks. Same options always yield the same graph.
 */
export function generateMockGraph(opts: MockOptions = {}): GraphData {
  const { seed = MOCK_SEED, nodes: nNodes = MOCK_NODE_COUNT, edges: nEdges = MOCK_EDGE_COUNT } = opts;
  const rand = mulberry32(seed);

  const typeIdx = new Uint8Array(nNodes);
  const nodes: GraphNode[] = new Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    const r = rand();
    let t = 0;
    while (r >= CUMULATIVE_WEIGHTS[t]) t++;
    typeIdx[i] = t;
    nodes[i] = { id: `${TYPES[t][0].toLowerCase()}${i}`, type: TYPES[t], label: `${TYPES[t]} ${i}` };
  }

  const endpoints = new Uint32Array(nEdges * 2);
  const edges: GraphEdge[] = new Array(nEdges);
  let m = 0;
  while (m < nEdges) {
    const a = Math.floor(rand() * nNodes);
    const b = m > 0 && rand() < 0.5 ? endpoints[Math.floor(rand() * m * 2)] : Math.floor(rand() * nNodes);
    if (a === b) continue;
    endpoints[m * 2] = a;
    endpoints[m * 2 + 1] = b;
    const choices = EDGE_TYPES[typeIdx[a]];
    edges[m++] = { source: nodes[a].id, target: nodes[b].id, type: choices[Math.floor(rand() * choices.length)] };
  }
  return { nodes, edges };
}
