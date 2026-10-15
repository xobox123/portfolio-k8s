// In-process log buffers. Images run in the same JS realm as the UI, so they write here
// directly; kubectl logs, the inspector and the Loki-style explorer read from it.
export type Level = "INFO" | "WARN" | "FATAL";
export interface LogEntry { id: number; ts: number; ns: string; pod: string; app: string; level: Level; line: string }

const buffers = new Map<string, string[]>();
const MAX = 200;
const STREAM_MAX = 2500;
const stream: LogEntry[] = [];
let seq = 0;

export const podKey = (ns: string, name: string) => `${ns}/${name}`;

export function pushLog(ns: string, pod: string, level: Level, message: string, app = pod): void {
  const key = podKey(ns, pod);
  const now = Date.now();
  const lines = buffers.get(key) ?? [];
  lines.push(`${new Date(now).toISOString()} ${level.padEnd(5)} ${message}`);
  if (lines.length > MAX) lines.shift();
  buffers.set(key, lines);
  stream.push({ id: ++seq, ts: now, ns, pod, app, level, line: message });
  if (stream.length > STREAM_MAX) stream.splice(0, stream.length - STREAM_MAX);
}

export const readLogs = (ns: string, pod: string): string[] => buffers.get(podKey(ns, pod)) ?? [];
export const dropLogs = (ns: string, pod: string): void => void buffers.delete(podKey(ns, pod));
export const logStream = (): readonly LogEntry[] => stream;
export const resetLogs = (): void => { buffers.clear(); stream.length = 0; };
