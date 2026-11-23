# J.A.R.V.I.S. graph orb

A rotating 3D sphere of glowing graph nodes and edges (Vite + TypeScript + three.js), with additive glow/bloom, pulsing, drag-to-rotate, scroll-to-zoom, and a switchable cyan/gold theme.

| Cyan | Gold |
| --- | --- |
| ![cyan](docs/jarvis-orb-cyan.png) | ![gold](docs/jarvis-orb-gold.png) |

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typecheck + production bundle
npm run generate:mock                 # optional: dump the mock graph to data/generated/mock-graph.ndjson (gitignored)
npm run generate:mock -- 7 50000 200000   # seed, node count, edge count
```

Drag to rotate, scroll to zoom, press `T` (or the button) to toggle the theme.

## Scale and rendering cap

The mock graph is **1,200,000 nodes and 4,000,000 edges** (seed 1138, heavy-tailed degrees via preferential attachment, fully deterministic). It is generated in memory at page load: about 0.9 s, roughly 360 MB JS heap, measured in headless Chrome on a cloud VM; your machine will differ. `npm run generate:mock` writes the same graph as streamed NDJSON (about 330 MB, ~6 s) to `data/generated/` for inspection or loading elsewhere; it is gitignored.

The full graph is loaded, but only a capped, connected, hub-centred subgraph is drawn so the frame rate stays smooth: at most **1,600 nodes and 3,600 edges** (`DEFAULT_LIMITS` in `src/sample.ts`; about 1,600 / 1,200 with the default mock). Selection takes about 1 s once at startup. Raise the limits there to draw more. A small footer shows loaded vs. drawn counts.

## Layout

- `src/data/types.ts` – `GraphData` and the `GraphDataSource` interface (`getGraph(): Promise<GraphData>`). The renderer depends only on this.
- `src/data/MockDataSource.ts` / `mockGenerator.ts` – builds the seeded mock graph in memory (nodes: `id/type/label`, edges: `source/target/type`). Nothing large is committed or fetched.
- `src/sample.ts` – picks the subgraph that is actually drawn (see below).
- `src/data/TigerGraphDataSource.ts` – stub calling a GSQL query over REST++.
- `src/data/index.ts` – `createDataSource()`, the one place a backend is chosen.
- `src/layout.ts` – deterministic force layout projected onto the sphere (positions are not part of the data).
- `src/orb.ts` – three.js scene, shaders, bloom, input.

## Connecting TigerGraph

1. Install a GSQL query that returns one result object `{ nodes: [{id,type,label}], edges: [{source,target,type}] }`, e.g. named `jarvis_graph`.
2. Copy `.env.example` to `.env.local` and set:
   ```
   VITE_DATA_SOURCE=tigergraph
   VITE_TG_HOST=https://<your-instance>
   VITE_TG_GRAPH=<graph name>
   VITE_TG_QUERY=jarvis_graph
   VITE_TG_TOKEN=<token, optional>
   ```
3. Finish `toGraphData()` in `src/data/TigerGraphDataSource.ts` if your query's output differs from the shape above (TigerGraph returns vertices as `v_id`/`v_type`/`attributes`).

The caps apply to any source, so a large TigerGraph result is sampled the same way. No rendering code changes are needed. For other backends, implement `GraphDataSource` and return it from `createDataSource()`. Note that `VITE_*` variables are bundled into the client, so for production proxy TigerGraph through a server rather than shipping a token to the browser.
