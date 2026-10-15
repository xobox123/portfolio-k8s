import type { ClusterStore } from "./store";
import { podReady, podStatus, podRestarts, nsOf } from "../kubectl/resources";

export interface Sample {
  t: number;
  rps: number;
  rpsByNs: Record<string, number>;
  p50: number;
  p95: number;
  ready: number;
  total: number;
  crashing: number;
  restartsByNs: Record<string, number>;
}

export const WINDOW = 90;

/** A tiny Prometheus stand-in: samples the simulator once a second into a ring buffer. */
export class Metrics {
  samples: Sample[] = [];
  private timer: ReturnType<typeof setInterval>;
  private lastTotal = 0;
  private lastByNs = new Map<string, number>();
  private lastT = performance.now();

  constructor(private store: ClusterStore) {
    this.timer = setInterval(() => this.tick(), 1000);
  }

  dispose(): void { clearInterval(this.timer); }

  private tick(): void {
    const s = this.store;
    const now = performance.now();
    const dt = Math.max(0.2, (now - this.lastT) / 1000);
    this.lastT = now;

    const rpsByNs: Record<string, number> = {};
    for (const [ns, n] of s.flowByNs) rpsByNs[ns] = Math.round(((n - (this.lastByNs.get(ns) ?? 0)) / dt) * 10) / 10;
    this.lastByNs = new Map(s.flowByNs);
    const rps = Math.round(((s.flowTotal - this.lastTotal) / dt) * 10) / 10;
    this.lastTotal = s.flowTotal;

    const lat = s.latencies.splice(0).sort((a, b) => a - b);
    const q = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))] : this.samples[this.samples.length - 1]?.[p === 0.5 ? "p50" : "p95"] ?? 0);

    let ready = 0; let total = 0; let crashing = 0;
    const restartsByNs: Record<string, number> = {};
    for (const p of s.list("pods")) {
      const ns = nsOf(p);
      if (ns === "kube-system") continue;
      total++;
      const st = podStatus(p);
      if (st === "Running" && !podReady(p).startsWith("0/")) ready++;
      if (st === "CrashLoopBackOff") crashing++;
      const r = podRestarts(p);
      if (r) restartsByNs[ns] = (restartsByNs[ns] ?? 0) + r;
    }

    this.samples.push({ t: Date.now(), rps, rpsByNs, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), ready, total, crashing, restartsByNs });
    if (this.samples.length > WINDOW) this.samples.shift();
  }
}
