function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic force layout constrained to the unit sphere (O(n^2), so only for the small
 * sampled skeleton). `links` holds local index pairs. Returns unit vectors, xyz per node.
 */
export function forceLayoutOnSphere(count: number, links: Uint32Array, iterations = 120): Float32Array {
  const rand = mulberry32(7);
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const z = rand() * 2 - 1;
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    p.set([r * Math.cos(a), z, r * Math.sin(a)], i * 3);
  }
  const f = new Float32Array(count * 3);
  const ideal = Math.sqrt((4 * Math.PI) / Math.max(count, 1));
  for (let it = 0; it < iterations; it++) {
    f.fill(0);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = p[i * 3] - p[j * 3], dy = p[i * 3 + 1] - p[j * 3 + 1], dz = p[i * 3 + 2] - p[j * 3 + 2];
        const k = (ideal * ideal * 0.5) / (dx * dx + dy * dy + dz * dz + 1e-4);
        f[i * 3] += dx * k; f[i * 3 + 1] += dy * k; f[i * 3 + 2] += dz * k;
        f[j * 3] -= dx * k; f[j * 3 + 1] -= dy * k; f[j * 3 + 2] -= dz * k;
      }
    }
    for (let l = 0; l < links.length; l += 2) {
      const a = links[l], b = links[l + 1];
      const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
      f[a * 3] += dx * 0.35; f[a * 3 + 1] += dy * 0.35; f[a * 3 + 2] += dz * 0.35;
      f[b * 3] -= dx * 0.35; f[b * 3 + 1] -= dy * 0.35; f[b * 3 + 2] -= dz * 0.35;
    }
    const step = 0.12 * (1 - it / iterations) + 0.01;
    for (let i = 0; i < count; i++) {
      const x = p[i * 3] + f[i * 3] * step, y = p[i * 3 + 1] + f[i * 3 + 1] * step, z = p[i * 3 + 2] + f[i * 3 + 2] * step;
      const len = Math.hypot(x, y, z) || 1;
      p[i * 3] = x / len; p[i * 3 + 1] = y / len; p[i * 3 + 2] = z / len;
    }
  }
  return p;
}

/**
 * Linear-time layout for the whole graph:
 * 1. force-layout the sampled hub skeleton on the sphere;
 * 2. sweep the edge list a few times, dropping each unplaced node near an already placed
 *    neighbour (scatter grows with that neighbour's degree, so hubs get halos);
 * 3. anything still unplaced (isolated) gets a seeded uniform spot.
 * Output is xyz per node on a shell of radius ~1.
 */
export function layoutFullGraph(
  n: number,
  ends: Uint32Array,
  degree: Uint32Array,
  sample: { nodes: Uint32Array; edges: Uint32Array },
): Float32Array {
  const rand = mulberry32(11);
  const pos = new Float32Array(n * 3);
  const placed = new Uint8Array(n);

  const local = new Map<number, number>();
  sample.nodes.forEach((g, i) => local.set(g, i));
  const links = new Uint32Array(sample.edges.length * 2);
  sample.edges.forEach((k, j) => { links[j * 2] = local.get(ends[k * 2])!; links[j * 2 + 1] = local.get(ends[k * 2 + 1])!; });
  const skeleton = forceLayoutOnSphere(sample.nodes.length, links);
  sample.nodes.forEach((g, i) => {
    pos.set(skeleton.subarray(i * 3, i * 3 + 3), g * 3);
    placed[g] = 1;
  });

  const placeNear = (child: number, parent: number) => {
    const spread = 0.008 + 0.07 * Math.min(1, Math.sqrt(degree[parent]) / 60);
    let x = pos[parent * 3] + (rand() + rand() + rand() - 1.5) * spread;
    let y = pos[parent * 3 + 1] + (rand() + rand() + rand() - 1.5) * spread;
    let z = pos[parent * 3 + 2] + (rand() + rand() + rand() - 1.5) * spread;
    const len = Math.hypot(x, y, z) || 1;
    pos[child * 3] = x / len; pos[child * 3 + 1] = y / len; pos[child * 3 + 2] = z / len;
    placed[child] = 1;
  };
  const m = ends.length / 2;
  for (let pass = 0; pass < 6; pass++) {
    let added = 0;
    for (let k = 0; k < m; k++) {
      const a = ends[k * 2], b = ends[k * 2 + 1];
      if (placed[a] && !placed[b]) { placeNear(b, a); added++; }
      else if (placed[b] && !placed[a]) { placeNear(a, b); added++; }
    }
    if (!added) break;
  }
  for (let i = 0; i < n; i++) {
    if (placed[i]) continue;
    const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    pos[i * 3] = r * Math.cos(a); pos[i * 3 + 1] = z; pos[i * 3 + 2] = r * Math.sin(a);
  }
  // Slight shell thickness so the orb reads as a volume rather than a painted surface.
  for (let i = 0; i < n; i++) {
    const s = 1 + (rand() - 0.5) * 0.06;
    pos[i * 3] *= s; pos[i * 3 + 1] *= s; pos[i * 3 + 2] *= s;
  }
  return pos;
}
