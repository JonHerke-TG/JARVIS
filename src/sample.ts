export interface SampleLimits {
  maxNodes: number;
  maxEdges: number;
}

export const DEFAULT_LIMITS: SampleLimits = { maxNodes: 1600, maxEdges: 3600 };

/**
 * Picks a connected, hub-centred subgraph (node and edge indices). It is the "sampled" view
 * and also the skeleton the full layout grows from. Deterministic: seeds with the
 * highest-degree nodes, grows through incident edges in data order up to the node cap,
 * then keeps edges whose endpoints both survived.
 */
export function sampleIndices(
  n: number,
  ends: Uint32Array,
  degree: Uint32Array,
  { maxNodes, maxEdges }: SampleLimits = DEFAULT_LIMITS,
): { nodes: Uint32Array; edges: Uint32Array } {
  const m = ends.length / 2;
  const selected = new Uint8Array(n);
  let count = 0;
  if (n <= maxNodes) {
    selected.fill(1);
    count = n;
  } else {
    // Counting sort by degree to find the top hubs without sorting 1M+ entries.
    const maxDeg = degree.reduce((acc, d) => (d > acc ? d : acc), 0);
    const histogram = new Uint32Array(maxDeg + 1);
    for (let i = 0; i < n; i++) histogram[degree[i]]++;
    const seedCount = Math.floor(maxNodes * 0.35);
    let threshold = maxDeg, taken = 0;
    while (threshold > 0 && taken + histogram[threshold] <= seedCount) taken += histogram[threshold--];
    for (let i = 0; i < n && count < seedCount; i++) if (degree[i] > threshold) { selected[i] = 1; count++; }
    for (let k = 0; k < m && count < maxNodes; k++) {
      const a = ends[k * 2], b = ends[k * 2 + 1];
      if (selected[a] && !selected[b]) { selected[b] = 1; count++; }
      else if (selected[b] && !selected[a]) { selected[a] = 1; count++; }
    }
  }
  const nodes = new Uint32Array(count);
  for (let i = 0, j = 0; i < n; i++) if (selected[i]) nodes[j++] = i;
  const edges: number[] = [];
  for (let k = 0; k < m && edges.length < maxEdges; k++) {
    if (selected[ends[k * 2]] && selected[ends[k * 2 + 1]]) edges.push(k);
  }
  return { nodes, edges: Uint32Array.from(edges) };
}
