import { createWriteStream, mkdirSync } from "node:fs";
import { once } from "node:events";
import { generateMockGraph, MOCK_EDGE_COUNT, MOCK_NODE_COUNT, MOCK_SEED } from "../src/data/mockGenerator";

const [seed = MOCK_SEED, nodes = MOCK_NODE_COUNT, edges = MOCK_EDGE_COUNT] = process.argv.slice(2).map(Number);

const outDir = new URL("../data/generated/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const outFile = new URL("mock-graph.ndjson", outDir);

const t0 = Date.now();
const graph = generateMockGraph({ seed, nodes, edges });

// One JSON record per line ({"n":...} / {"e":...}), written with backpressure so the file never needs to fit in a string.
const out = createWriteStream(outFile);
async function writeAll(kind: "n" | "e", items: object[]) {
  let buf: string[] = [];
  for (const item of items) {
    buf.push(JSON.stringify({ [kind]: item }));
    if (buf.length === 50_000) {
      if (!out.write(buf.join("\n") + "\n")) await once(out, "drain");
      buf = [];
    }
  }
  if (buf.length) out.write(buf.join("\n") + "\n");
}
await writeAll("n", graph.nodes);
await writeAll("e", graph.edges);
out.end();
await once(out, "finish");
console.log(`seed=${seed} nodes=${graph.nodes.length} edges=${graph.edges.length} -> ${outFile.pathname} (${Date.now() - t0} ms)`);
