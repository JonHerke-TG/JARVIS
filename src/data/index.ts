import { MockDataSource } from "./MockDataSource";
import { TigerGraphDataSource } from "./TigerGraphDataSource";
import type { GraphDataSource } from "./types";

export type { GraphData, GraphDataSource, GraphEdge, GraphNode } from "./types";

/** Single place to choose the backend. Rendering code only ever sees `GraphDataSource`. */
export function createDataSource(): GraphDataSource {
  return import.meta.env.VITE_DATA_SOURCE === "tigergraph"
    ? new TigerGraphDataSource()
    : new MockDataSource();
}
