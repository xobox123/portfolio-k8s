import { Cluster, newLatencyProvider, type ClusterApplyResource } from "@ngrok/webernetes";
import { CvServiceImage, genericImages } from "./images";
import { employers } from "./cv";
import { resetLab } from "./events";
import { resetLogs } from "./logs";
import { ClusterStore } from "./store";

export function resources(): ClusterApplyResource[] {
  const out: ClusterApplyResource[] = [];
  for (const e of employers) {
    out.push({ apiVersion: "v1", kind: "Namespace", metadata: { name: e.ns, annotations: {
      "cv.portfolio/company": e.company, "cv.portfolio/role": e.role, "cv.portfolio/period": e.period, "cv.portfolio/location": e.place } } });
  }
  for (const e of employers) {
    for (const w of e.workloads) {
      const labels = { app: w.name };
      out.push({
        apiVersion: "apps/v1", kind: "Deployment",
        metadata: { name: w.name, namespace: e.ns, labels, annotations: { "cv.portfolio/summary": w.what, "cv.portfolio/stack": w.tags.join(", ") } },
        spec: {
          replicas: w.replicas,
          selector: { matchLabels: labels },
          template: { metadata: { labels }, spec: { containers: [{
            name: w.name, image: "cv/service:1.0", ports: [{ containerPort: 8080 }],
            env: [
              { name: "SERVICE", value: w.name }, { name: "SUMMARY", value: w.what },
              { name: "CALLS", value: (w.calls ?? []).map((c) => { const port = e.workloads.find((x) => x.name === c)?.port; return port ? `${c}:${port}` : c; }).join(",") },
              ...(w.crash ? [{ name: "CRASH", value: "1" }] : []),
            ],
          }] } },
        },
      } as ClusterApplyResource);
      out.push({
        apiVersion: "v1", kind: "Service", metadata: { name: w.name, namespace: e.ns, labels },
        spec: { type: "ClusterIP", selector: labels, ports: [{ port: w.port ?? 80, targetPort: 8080 }] },
      } as ClusterApplyResource);
    }
  }
  return out;
}

export interface BootTimings { initMs: number; applyMs: number }

export async function bootCluster(): Promise<{ cluster: Cluster; store: ClusterStore; timings: BootTimings }> {
  resetLab();
  resetLogs();
  // a little network latency so the latency panels have something honest to show:
  // a per-service base (stable hash) plus jitter and the occasional slow request
  const hash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const latencyProvider = newLatencyProvider({
    clusterNetworkRequestLatency: (_ctx, e) => {
      const last = e.chain[e.chain.length - 1];
      const name = last && last.type === "service" ? last.resource.metadata?.name ?? "" : "";
      return 3 + (hash(name) % 12) + Math.random() * 8 + (Math.random() < 0.05 ? 35 + Math.random() * 40 : 0);
    },
    clusterNetworkResponseLatency: () => 1 + Math.random() * 5,
  });
  const cluster = new Cluster({ latencyProvider });
  cluster.registerImage(CvServiceImage);
  genericImages.forEach((i) => cluster.registerImage(i));
  const t0 = performance.now();
  await cluster.init();
  const t1 = performance.now();
  await cluster.apply(resources());
  const t2 = performance.now();
  const store = new ClusterStore(cluster);
  return { cluster, store, timings: { initMs: Math.round(t1 - t0), applyMs: Math.round(t2 - t1) } };
}
