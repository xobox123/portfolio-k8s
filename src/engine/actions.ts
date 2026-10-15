import type { ClusterStore } from "./store";
import { dropLogs } from "./logs";

/** The only namespace where visitors may create and delete things. */
export const SANDBOX = "sandbox";

const labelsFor = (name: string) => ({ app: name, "created-by": "visitor" });
const containerName = (image: string) => image.split("/").pop()!.split(":")[0].replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "app";

export async function scaleDeployment(store: ClusterStore, ns: string, name: string, replicas: number): Promise<void> {
  const d = await store.client.appsv1.readNamespacedDeployment({ name, namespace: ns });
  d.spec!.replicas = replicas;
  await store.client.appsv1.replaceNamespacedDeployment({ name, namespace: ns, body: d });
}

export async function restartDeployment(store: ClusterStore, ns: string, name: string): Promise<void> {
  const d = await store.client.appsv1.readNamespacedDeployment({ name, namespace: ns });
  const tpl = d.spec!.template;
  tpl.metadata = { ...(tpl.metadata ?? {}), annotations: { ...(tpl.metadata?.annotations ?? {}), "kubectl.kubernetes.io/restartedAt": new Date().toISOString() } };
  await store.client.appsv1.replaceNamespacedDeployment({ name, namespace: ns, body: d });
}

export async function setWorkerEnv(store: ClusterStore, ns: string, name: string, key: string, value: string): Promise<void> {
  const d = await store.client.appsv1.readNamespacedDeployment({ name, namespace: ns });
  const c = d.spec!.template.spec!.containers[0];
  c.env = [...(c.env ?? []).filter((e) => e.name !== key), { name: key, value }];
  await store.client.appsv1.replaceNamespacedDeployment({ name, namespace: ns, body: d });
}

/** Env names the simulator itself relies on; hidden from the edit form and always preserved. */
export const INTERNAL_ENV = new Set(["SERVICE", "SUMMARY", "CALLS", "CRASH"]);

export async function updateDeployment(store: ClusterStore, ns: string, name: string, change: { replicas: number; env: Array<{ name: string; value: string }>; image?: string }): Promise<void> {
  const d = await store.client.appsv1.readNamespacedDeployment({ name, namespace: ns });
  d.spec!.replicas = change.replicas;
  const c = d.spec!.template.spec!.containers[0];
  if (change.image) c.image = change.image;
  c.env = [...(c.env ?? []).filter((e) => INTERNAL_ENV.has(e.name)), ...change.env.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), value: e.value }))];
  await store.client.appsv1.replaceNamespacedDeployment({ name, namespace: ns, body: d });
}

/** Chaos: delete a random slice of pods and let Kubernetes heal itself. Returns the pod names. */
export async function chaosKill(store: ClusterStore): Promise<string[]> {
  const pods = store.list("pods").filter((p) => p.metadata?.namespace !== "kube-system" && !p.metadata?.deletionTimestamp);
  const n = Math.min(pods.length, Math.max(3, Math.round(pods.length * 0.12)));
  const victims = [...pods].sort(() => Math.random() - 0.5).slice(0, n);
  await Promise.all(victims.map((p) => store.client.corev1.deleteNamespacedPod({ name: p.metadata!.name!, namespace: p.metadata!.namespace! }).catch(() => undefined)));
  victims.forEach((p) => dropLogs(p.metadata!.namespace!, p.metadata!.name!));
  return victims.map((p) => `${p.metadata!.namespace}/${p.metadata!.name}`);
}

export async function deletePod(store: ClusterStore, ns: string, name: string): Promise<void> {
  await store.client.corev1.deleteNamespacedPod({ name, namespace: ns });
  dropLogs(ns, name);
}

export async function createDeployment(store: ClusterStore, name: string, image: string, replicas: number): Promise<void> {
  const labels = labelsFor(name);
  await store.cluster.apply([{
    apiVersion: "apps/v1", kind: "Deployment", metadata: { name, namespace: SANDBOX, labels },
    spec: { replicas, selector: { matchLabels: { app: name } }, template: { metadata: { labels }, spec: { containers: [{ name: containerName(image), image }] } } },
  }]);
}

export async function createPod(store: ClusterStore, name: string, image: string): Promise<void> {
  await store.cluster.apply([{
    apiVersion: "v1", kind: "Pod", metadata: { name, namespace: SANDBOX, labels: labelsFor(name) },
    spec: { containers: [{ name: containerName(image), image }] },
  }]);
}

export async function exposeDeployment(store: ClusterStore, name: string, port: number, targetPort: number, type: "ClusterIP" | "NodePort"): Promise<void> {
  await store.cluster.apply([{
    apiVersion: "v1", kind: "Service", metadata: { name, namespace: SANDBOX, labels: labelsFor(name) },
    spec: { type, selector: { app: name }, ports: [{ port, targetPort }] },
  }]);
}

export async function deleteResource(store: ClusterStore, kind: "deployments" | "pods" | "services", name: string): Promise<void> {
  if (kind === "deployments") await store.client.appsv1.deleteNamespacedDeployment({ name, namespace: SANDBOX });
  else if (kind === "pods") await store.client.corev1.deleteNamespacedPod({ name, namespace: SANDBOX });
  else await store.client.corev1.deleteNamespacedService({ name, namespace: SANDBOX });
}
