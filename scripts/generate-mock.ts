import { writeFileSync } from "node:fs";
import type { GraphData } from "../src/data/types";

const SEED = Number(process.argv[2] ?? 1138);
const N_NODES = 700;

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

const TYPES = ["Person", "Company", "Account", "Device", "Document", "Location"];
const WEIGHTS = [0.3, 0.12, 0.2, 0.16, 0.14, 0.08];
const EDGE_TYPES: Record<string, string[]> = {
  Person: ["KNOWS", "WORKS_AT", "OWNS"],
  Company: ["PARTNER_OF", "LOCATED_IN"],
  Account: ["TRANSFERS_TO", "OWNED_BY"],
  Device: ["USED_BY", "SEEN_AT"],
  Document: ["MENTIONS", "AUTHORED_BY"],
  Location: ["NEAR"],
};

function pickType() {
  let r = rand();
  for (let i = 0; i < TYPES.length; i++) if ((r -= WEIGHTS[i]) < 0) return TYPES[i];
  return TYPES[0];
}

const nodes: GraphData["nodes"] = [];
const byType: Record<string, string[]> = {};
for (let i = 0; i < N_NODES; i++) {
  const type = pickType();
  const id = `${type[0].toLowerCase()}${i}`;
  nodes.push({ id, type, label: `${type} ${i}` });
  (byType[type] ??= []).push(id);
}

// Mostly intra-type links with a preferential tail, plus cross-type bridges.
const seen = new Set<string>();
const edges: GraphData["edges"] = [];
const add = (a: string, b: string, type: string) => {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (a === b || seen.has(key)) return;
  seen.add(key);
  edges.push({ source: a, target: b, type });
};
for (const n of nodes) {
  const degree = 1 + Math.floor(rand() * rand() * 5);
  for (let k = 0; k < degree; k++) {
    const crossType = rand() < 0.25;
    const pool = crossType ? nodes.map((x) => x.id) : byType[n.type];
    add(n.id, pick(pool), pick(EDGE_TYPES[n.type]));
  }
}

const out = new URL("../src/data/mock-graph.json", import.meta.url);
writeFileSync(out, JSON.stringify({ nodes, edges }) + "\n");
console.log(`seed=${SEED} nodes=${nodes.length} edges=${edges.length}`);
