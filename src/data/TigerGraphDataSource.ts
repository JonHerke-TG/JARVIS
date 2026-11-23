import type { GraphData, GraphDataSource } from "./types";

export interface TigerGraphConfig {
  /** Base URL, e.g. https://my-instance.i.tgcloud.io (REST++ is served under /restpp on 9000 or via gateway). */
  host: string;
  graph: string;
  /** Name of an installed GSQL query that returns the graph (see README). */
  query: string;
  /** Bearer token / secret-derived token. Optional for open dev instances. */
  token?: string;
}

export function tigerGraphConfigFromEnv(env: ImportMetaEnv = import.meta.env): TigerGraphConfig {
  return {
    host: env.VITE_TG_HOST,
    graph: env.VITE_TG_GRAPH,
    query: env.VITE_TG_QUERY ?? "jarvis_graph",
    token: env.VITE_TG_TOKEN || undefined,
  };
}

/**
 * Stub: calls an installed GSQL query over REST++ and maps the result to GraphData.
 *
 *   GET {host}/restpp/query/{graph}/{query}
 *
 * Expected response shape: results[0] = { nodes: [{ id, type, label }], edges: [{ source, target, type }] }.
 * Adapt `toGraphData` to your query's actual output (vertex sets / edge sets use v_id, v_type, attributes).
 */
export class TigerGraphDataSource implements GraphDataSource {
  constructor(private readonly config: TigerGraphConfig = tigerGraphConfigFromEnv()) {}

  async getGraph(): Promise<GraphData> {
    const { host, graph, query, token } = this.config;
    if (!host || !graph) {
      throw new Error("TigerGraphDataSource: set VITE_TG_HOST and VITE_TG_GRAPH (see .env.example)");
    }
    const res = await fetch(`${host.replace(/\/$/, "")}/restpp/query/${graph}/${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`TigerGraph query failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    if (body.error) throw new Error(`TigerGraph error: ${body.message}`);
    return this.toGraphData(body.results);
  }

  // TODO: map your query's output here.
  private toGraphData(results: unknown): GraphData {
    const first = (results as GraphData[] | undefined)?.[0];
    if (!first?.nodes || !first?.edges) {
      throw new Error("TigerGraphDataSource.toGraphData: unexpected query result shape");
    }
    return { nodes: first.nodes, edges: first.edges };
  }
}
