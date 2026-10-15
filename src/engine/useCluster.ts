import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Cluster } from "@ngrok/webernetes";
import type { ClusterStore } from "./store";

export interface Booted { store: ClusterStore; bootedAt: string; generation: number }
export type BootState = { status: "booting" } | { status: "error"; error: string } | ({ status: "ready" } & Booted);

/** Boots the simulated cluster and can tear it down and boot a fresh one ("Redeploy"). */
export function useCluster() {
  const [state, setState] = useState<BootState>({ status: "booting" });
  const current = useRef<Cluster | undefined>(undefined);
  const currentStore = useRef<ClusterStore | undefined>(undefined);
  const generation = useRef(0);
  const alive = useRef(true);

  const boot = useCallback(async () => {
    const gen = ++generation.current;
    setState({ status: "booting" });
    const old = current.current;
    current.current = undefined;
    currentStore.current?.dispose();
    currentStore.current = undefined;
    if (old) await old.close().catch(() => undefined);
    try {
      const { bootCluster } = await import("./boot");
      const { cluster, store } = await bootCluster();
      if (!alive.current || gen !== generation.current) { await cluster.close().catch(() => undefined); return; }
      current.current = cluster;
      currentStore.current = store;
      setState({ status: "ready", store, bootedAt: new Date().toISOString(), generation: gen });
    } catch (e) {
      if (alive.current && gen === generation.current) setState({ status: "error", error: String(e) });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void boot();
    return () => { alive.current = false; currentStore.current?.dispose(); void current.current?.close().catch(() => undefined); };
  }, [boot]);

  return { state, redeploy: boot };
}

/** Re-render whenever the store changes. */
export function useStoreVersion(store: ClusterStore | undefined): number {
  return useSyncExternalStore(
    (cb) => (store ? store.subscribe(cb) : () => undefined),
    () => (store ? store.getVersion() : 0),
  );
}
