export interface GraphNode {
  id: string;
  type: string;
  label: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** The only thing the renderer knows about data. Implement this to plug in a new backend. */
export interface GraphDataSource {
  getGraph(): Promise<GraphData>;
}
