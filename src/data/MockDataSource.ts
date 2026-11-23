import { generateMockGraph, type MockOptions } from "./mockGenerator";
import type { GraphData, GraphDataSource } from "./types";

/**
 * Builds the seeded mock graph (1.2M nodes / 4M edges by default) in memory.
 * Nothing large is shipped or fetched; same seed, same graph.
 */
export class MockDataSource implements GraphDataSource {
  constructor(private readonly options: MockOptions = {}) {}

  async getGraph(): Promise<GraphData> {
    return generateMockGraph(this.options);
  }
}
