import type { GraphData, GraphDataSource } from "./types";
import mock from "./mock-graph.json";

/** Serves the static, seed-generated graph in `mock-graph.json` (see scripts/generate-mock.ts). */
export class MockDataSource implements GraphDataSource {
  async getGraph(): Promise<GraphData> {
    return mock as GraphData;
  }
}
