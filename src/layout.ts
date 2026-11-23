import type { GraphData } from "./data";

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic force layout constrained to the unit sphere surface:
 * pairwise repulsion + edge springs, re-projected each step.
 * Returns a flat xyz array (unit vectors), index-aligned with `graph.nodes`.
 */
export function layoutOnSphere(graph: GraphData, iterations = 120): Float32Array {
  const n = graph.nodes.length;
  const rand = mulberry32(7);
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    p.set([r * Math.cos(a), z, r * Math.sin(a)], i * 3);
  }
  const index = new Map(graph.nodes.map((nd, i) => [nd.id, i]));
  const links = graph.edges
    .map((e) => [index.get(e.source), index.get(e.target)] as const)
    .filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined);

  const f = new Float32Array(n * 3);
  const ideal = Math.sqrt((4 * Math.PI) / Math.max(n, 1)); // mean spacing on the unit sphere
  for (let it = 0; it < iterations; it++) {
    f.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = p[i * 3] - p[j * 3], dy = p[i * 3 + 1] - p[j * 3 + 1], dz = p[i * 3 + 2] - p[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz + 1e-4;
        const k = (ideal * ideal * 0.5) / d2;
        f[i * 3] += dx * k; f[i * 3 + 1] += dy * k; f[i * 3 + 2] += dz * k;
        f[j * 3] -= dx * k; f[j * 3 + 1] -= dy * k; f[j * 3 + 2] -= dz * k;
      }
    }
    for (const [a, b] of links) {
      const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
      const k = 0.35;
      f[a * 3] += dx * k; f[a * 3 + 1] += dy * k; f[a * 3 + 2] += dz * k;
      f[b * 3] -= dx * k; f[b * 3 + 1] -= dy * k; f[b * 3 + 2] -= dz * k;
    }
    const step = 0.12 * (1 - it / iterations) + 0.01;
    for (let i = 0; i < n; i++) {
      let x = p[i * 3] + f[i * 3] * step, y = p[i * 3 + 1] + f[i * 3 + 1] * step, z = p[i * 3 + 2] + f[i * 3 + 2] * step;
      const len = Math.hypot(x, y, z) || 1;
      p[i * 3] = x / len; p[i * 3 + 1] = y / len; p[i * 3 + 2] = z / len;
    }
  }
  return p;
}
