import { Cluster, KubeClient } from "@ngrok/webernetes";
import { Metrics } from "./metrics";
import type { V1Pod, V1Deployment, V1ReplicaSet, V1Service, V1Namespace, V1Node, CoreV1Event, V1EndpointSlice } from "@kubernetes/client-node";

export interface Flow { id: number; t: number; hops: string[] }

type Kinds = {
  pods: V1Pod; deployments: V1Deployment; replicasets: V1ReplicaSet; services: V1Service;
  namespaces: V1Namespace; nodes: V1Node; events: CoreV1Event; endpointslices: V1EndpointSlice;
};
export type KindName = keyof Kinds;

export const keyOf = (o: { metadata?: { namespace?: string; name?: string } }) =>
  o.metadata?.namespace ? `${o.metadata.namespace}/${o.metadata.name}` : `${o.metadata?.name}`;

export class ClusterStore {
  readonly data: { [K in KindName]: Map<string, Kinds[K]> } = {
    pods: new Map(), deployments: new Map(), replicasets: new Map(), services: new Map(),
    namespaces: new Map(), nodes: new Map(), events: new Map(), endpointslices: new Map(),
  };
  flows: Flow[] = [];
  /** cumulative request counters and per-tick latencies, consumed by the metrics sampler */
  flowTotal = 0;
  flowByNs = new Map<string, number>();
  latencies: number[] = [];
  readonly metrics: Metrics;
  version = 0;
  readonly client: KubeClient;
  private listeners = new Set<() => void>();
  private flowId = 0;
  private pending = false;

  constructor(readonly cluster: Cluster) {
    this.client = new KubeClient(cluster.kubeConfig);
    for (const kind of Object.keys(this.data) as KindName[]) {
      cluster.informer(kind as never, ((type: string, obj: { metadata?: { namespace?: string; name?: string } }) => {
        const m = this.data[kind] as Map<string, unknown>;
        if (type === "delete") m.delete(keyOf(obj)); else m.set(keyOf(obj), obj);
        this.touch();
      }) as never);
    }
    this.metrics = new Metrics(this);
    cluster.on("request", (e) => {
      this.flowTotal++;
      const last = [...e.chain].reverse().find((h) => h.type === "pod");
      const ns = last && last.type === "pod" ? last.resource.metadata?.namespace : undefined;
      if (ns) this.flowByNs.set(ns, (this.flowByNs.get(ns) ?? 0) + 1);
      this.latencies.push(e.latencyMs);
      const hops = e.chain.map((h) => h.type === "external" ? `external/${h.host}` : h.type === "node" ? `node/${h.resource.metadata?.name}` : `${h.type}/${keyOf(h.resource)}`);
      this.flows.push({ id: ++this.flowId, t: performance.now(), hops });
      if (this.flows.length > 80) this.flows.splice(0, this.flows.length - 80);
      this.touch();
    });
  }

  dispose(): void { this.metrics.dispose(); }

  list<K extends KindName>(kind: K): Kinds[K][] { return [...this.data[kind].values()] as Kinds[K][]; }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;

  private touch() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => { this.pending = false; this.version++; this.listeners.forEach((l) => l()); });
  }
}
