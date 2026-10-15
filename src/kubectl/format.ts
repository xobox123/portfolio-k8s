// kubectl-style output helpers: table layout, ages, YAML.

/** Age in kubectl's compact style (e.g. 45s, 3m20s, 2h, 5d, 3y120d). */
export function age(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 120) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 10) return `${m}m${s % 60 ? `${s % 60}s` : ""}`;
  if (m < 180) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 8) return `${h}h${m % 60 ? `${m % 60}m` : ""}`;
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 8) return `${d}d${h % 24 ? `${h % 24}h` : ""}`;
  if (d < 730) return `${d}d`;
  const y = Math.floor(d / 365);
  return `${y}y${d % 365 ? `${d % 365}d` : ""}`;
}

export const ts = (v: unknown): number => (v ? new Date(v as string).getTime() : Date.now());
export const ageOf = (o: { metadata?: { creationTimestamp?: unknown } }): string => age(Date.now() - ts(o.metadata?.creationTimestamp));

/** Columns separated by three spaces, last column unpadded — like kubectl. */
export function table(header: string[], rows: string[][]): string {
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => (r[i] ?? "").length)));
  return all.map((r) => r.map((c, i) => (i === r.length - 1 ? c : (c ?? "").padEnd(widths[i] + 3))).join("")).join("\n");
}

/** Strip undefined/null and turn Dates into ISO strings. */
export function clean<T>(o: T): T {
  return JSON.parse(JSON.stringify(o, (_k, v) => (v === null ? undefined : v)));
}

const needsQuote = (s: string) =>
  s === "" || /^\d{4}-\d\d-\d\dT/.test(s) || /^[\s\-?:,\[\]{}#&*!|>'"%@`]|[:#]\s|\s$/.test(s) || /^(true|false|null|yes|no|on|off|~|[-+]?[0-9.]+(e[-+]?\d+)?)$/i.test(s) || s.includes("\n");
const scalar = (v: unknown): string => (typeof v === "string" ? (needsQuote(v) ? JSON.stringify(v) : v) : String(v));

export function yaml(o: unknown, indent = 0): string {
  const pad = " ".repeat(indent);
  if (Array.isArray(o)) {
    return o
      .map((v) => {
        if (v && typeof v === "object") return `${pad}- ${yaml(v, indent + 2).slice(indent + 2)}`;
        return `${pad}- ${scalar(v)}\n`;
      })
      .join("");
  }
  if (o && typeof o === "object") {
    let out = "";
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) out += v.length ? `${pad}${k}:\n${yaml(v, indent)}` : `${pad}${k}: []\n`;
      else if (v && typeof v === "object") out += Object.keys(v).length ? `${pad}${k}:\n${yaml(v, indent + 2)}` : `${pad}${k}: {}\n`;
      else out += `${pad}${k}: ${scalar(v)}\n`;
    }
    return out;
  }
  return `${pad}${scalar(o)}\n`;
}

export const labelsStr = (l?: Record<string, string>): string =>
  l && Object.keys(l).length ? Object.entries(l).map(([k, v]) => `${k}=${v}`).join(",") : "<none>";

/** Seeded pseudo-random in [0,1) for stable fake metrics. */
export function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
