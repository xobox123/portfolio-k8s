import type { ClusterStore } from "../engine/store";
import { virtualConfigMaps, virtualIngresses, type VObject } from "../engine/virtual";
import { ageOf, labelsStr, ts, age } from "./format";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Obj = any;

export interface Res {
  key: string;
  kind: string;
  /** names accepted on the command line */
  names: string[];
  /** apiVersion shown by api-resources / used for -o name */
  api: string;
  /** suffix used in `get all` / `-o name`, e.g. "deployment.apps" */
  qualified: string;
  group: string;
  namespaced: boolean;
  list: (s: Ctx) => Obj[];
  cols: string[];
  wide: string[];
  row: (o: Obj, wide: boolean, s: Ctx) => string[];
}

export interface Ctx { store: ClusterStore; bootedAt: string }

export const nameOf = (o: Obj): string => o.metadata?.name ?? "";
export const nsOf = (o: Obj): string => o.metadata?.namespace ?? "";

/* ---------- pod status the way kubectl derives it ---------- */
export function podStatus(p: Obj): string {
  if (p.metadata?.deletionTimestamp) return "Terminating";
  const cs: Obj[] = p.status?.containerStatuses ?? [];
  for (const c of cs) {
    const w = c.state?.waiting?.reason;
    if (w) return w;
    if (c.state?.terminated) return c.state.terminated.reason || (c.state.terminated.exitCode ? "Error" : "Completed");
  }
  return p.status?.phase ?? "Unknown";
}
export const podReady = (p: Obj): string => {
  const cs: Obj[] = p.status?.containerStatuses ?? [];
  const total = p.spec?.containers?.length ?? cs.length;
  return `${cs.filter((c) => c.ready).length}/${total}`;
};
export const podRestarts = (p: Obj): number => ((p.status?.containerStatuses ?? []) as Obj[]).reduce((n, c) => n + (c.restartCount ?? 0), 0);

const ports = (s: Obj): string => (s.spec?.ports ?? []).map((p: Obj) => `${p.port}${p.nodePort ? `:${p.nodePort}` : ""}/${p.protocol ?? "TCP"}`).join(",") || "<none>";

export const RESOURCES: Res[] = [
  {
    key: "pods", kind: "Pod", names: ["pods", "pod", "po"], api: "v1", qualified: "pod", group: "", namespaced: true,
    list: (c) => c.store.list("pods"),
    cols: ["NAME", "READY", "STATUS", "RESTARTS", "AGE"], wide: ["IP", "NODE", "NOMINATED NODE", "READINESS GATES"],
    row: (p, w) => [nameOf(p), podReady(p), podStatus(p), String(podRestarts(p)), ageOf(p), ...(w ? [p.status?.podIP ?? "<none>", p.spec?.nodeName ?? "<none>", "<none>", "<none>"] : [])],
  },
  {
    key: "deployments", kind: "Deployment", names: ["deployments", "deployment", "deploy"], api: "apps/v1", qualified: "deployment.apps", group: "apps", namespaced: true,
    list: (c) => c.store.list("deployments"),
    cols: ["NAME", "READY", "UP-TO-DATE", "AVAILABLE", "AGE"], wide: ["CONTAINERS", "IMAGES", "SELECTOR"],
    row: (d, w) => [nameOf(d), `${d.status?.readyReplicas ?? 0}/${d.spec?.replicas ?? 0}`, String(d.status?.updatedReplicas ?? 0), String(d.status?.availableReplicas ?? 0), ageOf(d),
      ...(w ? [d.spec.template.spec.containers.map((c: Obj) => c.name).join(","), d.spec.template.spec.containers.map((c: Obj) => c.image).join(","), labelsStr(d.spec.selector?.matchLabels)] : [])],
  },
  {
    key: "replicasets", kind: "ReplicaSet", names: ["replicasets", "replicaset", "rs"], api: "apps/v1", qualified: "replicaset.apps", group: "apps", namespaced: true,
    list: (c) => c.store.list("replicasets"),
    cols: ["NAME", "DESIRED", "CURRENT", "READY", "AGE"], wide: ["CONTAINERS", "IMAGES", "SELECTOR"],
    row: (r, w) => [nameOf(r), String(r.spec?.replicas ?? 0), String(r.status?.replicas ?? 0), String(r.status?.readyReplicas ?? 0), ageOf(r),
      ...(w ? [r.spec.template.spec.containers.map((c: Obj) => c.name).join(","), r.spec.template.spec.containers.map((c: Obj) => c.image).join(","), labelsStr(r.spec.selector?.matchLabels)] : [])],
  },
  {
    key: "services", kind: "Service", names: ["services", "service", "svc"], api: "v1", qualified: "service", group: "", namespaced: true,
    list: (c) => c.store.list("services"),
    cols: ["NAME", "TYPE", "CLUSTER-IP", "EXTERNAL-IP", "PORT(S)", "AGE"], wide: ["SELECTOR"],
    row: (s, w) => [nameOf(s), s.spec?.type ?? "ClusterIP", s.spec?.clusterIP ?? "<none>", "<none>", ports(s), ageOf(s), ...(w ? [labelsStr(s.spec?.selector)] : [])],
  },
  {
    key: "endpointslices", kind: "EndpointSlice", names: ["endpointslices", "endpointslice"], api: "discovery.k8s.io/v1", qualified: "endpointslice.discovery.k8s.io", group: "discovery.k8s.io", namespaced: true,
    list: (c) => c.store.list("endpointslices"),
    cols: ["NAME", "ADDRESSTYPE", "PORTS", "ENDPOINTS", "AGE"], wide: [],
    row: (e) => [nameOf(e), e.addressType ?? "IPv4", (e.ports ?? []).map((p: Obj) => p.port).join(",") || "<unset>", (e.endpoints ?? []).map((x: Obj) => x.addresses?.[0]).join(",") || "<unset>", ageOf(e)],
  },
  {
    key: "configmaps", kind: "ConfigMap", names: ["configmaps", "configmap", "cm"], api: "v1", qualified: "configmap", group: "", namespaced: true,
    list: (c) => virtualConfigMaps(c.bootedAt),
    cols: ["NAME", "DATA", "AGE"], wide: [],
    row: (m) => [nameOf(m), String(Object.keys(m.data ?? {}).length), ageOf(m)],
  },
  {
    key: "ingresses", kind: "Ingress", names: ["ingresses", "ingress", "ing"], api: "networking.k8s.io/v1", qualified: "ingress.networking.k8s.io", group: "networking.k8s.io", namespaced: true,
    list: (c) => virtualIngresses(c.bootedAt),
    cols: ["NAME", "CLASS", "HOSTS", "ADDRESS", "PORTS", "AGE"], wide: [],
    row: (i) => [nameOf(i), i.spec.ingressClassName ?? "<none>", (i.spec.rules ?? []).map((r: Obj) => r.host).join(","), "", "80", ageOf(i)],
  },
  {
    key: "nodes", kind: "Node", names: ["nodes", "node", "no"], api: "v1", qualified: "node", group: "", namespaced: false,
    list: (c) => c.store.list("nodes"),
    cols: ["NAME", "STATUS", "ROLES", "AGE", "VERSION"], wide: ["INTERNAL-IP", "EXTERNAL-IP", "OS-IMAGE", "KERNEL-VERSION", "CONTAINER-RUNTIME"],
    row: (n, w) => {
      const ready = (n.status?.conditions ?? []).find((c: Obj) => c.type === "Ready");
      const roles = Object.keys(n.metadata?.labels ?? {}).filter((k) => k.startsWith("node-role.kubernetes.io/")).map((k) => k.split("/")[1]).join(",") || "<none>";
      const ip = (n.status?.addresses ?? []).find((a: Obj) => a.type === "InternalIP")?.address ?? "<none>";
      return [nameOf(n), ready?.status === "True" ? "Ready" : "NotReady", roles, ageOf(n), n.status?.nodeInfo?.kubeletVersion ?? "v1.31.2", ...(w ? [ip, "<none>", n.status?.nodeInfo?.osImage ?? "webernetes", n.status?.nodeInfo?.kernelVersion ?? "-", n.status?.nodeInfo?.containerRuntimeVersion ?? "in-process"] : [])];
    },
  },
  {
    key: "namespaces", kind: "Namespace", names: ["namespaces", "namespace", "ns"], api: "v1", qualified: "namespace", group: "", namespaced: false,
    list: (c) => c.store.list("namespaces"),
    cols: ["NAME", "STATUS", "AGE"], wide: [],
    row: (n) => [nameOf(n), n.status?.phase ?? "Active", ageOf(n)],
  },
  {
    key: "events", kind: "Event", names: ["events", "event", "ev"], api: "v1", qualified: "event", group: "", namespaced: true,
    list: (c) => c.store.list("events").sort((a: Obj, b: Obj) => ts(a.lastTimestamp ?? a.eventTime ?? a.metadata?.creationTimestamp) - ts(b.lastTimestamp ?? b.eventTime ?? b.metadata?.creationTimestamp)),
    cols: ["LAST SEEN", "TYPE", "REASON", "OBJECT", "MESSAGE"], wide: [],
    row: (e) => [age(Date.now() - ts(e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp)), e.type ?? "Normal", e.reason ?? "", `${String(e.involvedObject?.kind ?? "").toLowerCase()}/${e.involvedObject?.name ?? ""}`, e.message ?? ""],
  },
];

export const findResource = (name: string): Res | undefined => {
  const n = name.toLowerCase();
  return RESOURCES.find((r) => r.names.includes(n));
};

export const objNs = (o: Obj): string => nsOf(o) || "";
export type { VObject };
