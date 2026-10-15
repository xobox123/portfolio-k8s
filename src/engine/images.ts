import { BaseImage, type ImageConstructor, type ProcessContext } from "@ngrok/webernetes";
import { pushLog } from "./logs";
import { emitSolved } from "./events";

/** One generic image: logs what the workload is about, serves HTTP and calls its upstreams. */
export class CvServiceImage extends BaseImage {
  static readonly imageName = "cv/service";
  static readonly imageVersion = "1.0";
  readonly defaultCommand = ["serve"];

  override async exec(ctx: ProcessContext, argv: readonly string[]): Promise<number> {
    if (argv[0] !== "serve") return await super.exec(ctx, argv);

    const service = ctx.env.get("SERVICE") ?? "service";
    const summary = ctx.env.get("SUMMARY") ?? "";
    const calls = (ctx.env.get("CALLS") ?? "").split(",").filter(Boolean);

    const ns = ctx.pod.namespace;
    const pod = ctx.pod.name;
    const log = (level: "INFO" | "WARN" | "FATAL", message: string) => {
      pushLog(ns, pod, level, message, service);
      (level === "INFO" ? ctx.writeStdout : ctx.writeStderr).call(ctx, `${level} ${message}\n`);
    };

    log("INFO", `${service} starting`);
    log("INFO", summary);
    if (ctx.env.get("CRASH") === "1") {
      const dbUrl = ctx.env.get("DATABASE_URL");
      if (!dbUrl) {
        log("FATAL", "DATABASE_URL is not set");
        log("INFO", "hint: the database runs in this namespace. See kubectl get svc -n incident-lab, then set DATABASE_URL (kubectl set env or the edit tab).");
        return 1;
      }
      let host = "";
      let port = "5432";
      try {
        const u = new URL(dbUrl);
        if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error(`unsupported scheme "${u.protocol.replace(":", "")}"`);
        host = u.hostname; port = u.port || "5432";
      } catch (e) {
        log("FATAL", `invalid DATABASE_URL: ${e instanceof Error ? e.message : String(e)}`);
        log("INFO", "hint: expected postgres://user:password@host:5432/dbname");
        return 1;
      }
      log("INFO", `connecting to ${host}:${port}`);
      try {
        const r = await ctx.fetch(`http://${host}:${port}/`);
        if (r.status >= 500) throw new Error(`server responded with status ${r.status}`);
      } catch (e) {
        log("FATAL", `could not connect to server at "${host}" (port ${port}): ${e instanceof Error ? e.message : String(e)}`);
        log("INFO", "hint: is that the right service name and port? Try kubectl get svc -n incident-lab");
        return 1;
      }
      log("INFO", `connected to postgres at ${host}:${port}`);
      emitSolved(ns, pod);
    }

    ctx.listenHttp(8080, async (_c, req) => {
      const upstream: number[] = [];
      for (const target of calls) {
        upstream.push(await ctx.fetch(`http://${target}/`).then((r) => r.status).catch(() => 0));
      }
      // access log: stream only, not process stdout, so the simulator's stdout buffer stays small
      pushLog(ns, pod, "INFO", `${req.method} ${req.url.pathname} 200${upstream.length ? ` upstream=[${upstream.join(",")}]` : ""}`, service);
      if (upstream.includes(0)) pushLog(ns, pod, "WARN", "upstream unavailable", service);
      return { status: 200, body: JSON.stringify({ service, upstream }) };
    });

    log("INFO", "listening on :8080");
    ctx.setInterval(async () => {
      for (const target of calls) await ctx.fetch(`http://${target}/`).catch(() => undefined);
    }, 2500 + Math.floor(Math.random() * 1500));

    return await ctx.waitUntilKilled();
  }
}

/** Stand-ins for well-known public images so visitors can create their own workloads in the sandbox. */
function genericImage(name: string, port: number, banner: string): ImageConstructor {
  return class extends BaseImage {
    static readonly imageName = name;
    static readonly imageVersion = "latest";
    readonly defaultCommand = ["start"];
    override async exec(ctx: ProcessContext, argv: readonly string[]): Promise<number> {
      if (argv[0] !== "start") return await super.exec(ctx, argv);
      const ns = ctx.pod.namespace;
      const pod = ctx.pod.name;
      pushLog(ns, pod, "INFO", `${banner}`, name);
      pushLog(ns, pod, "INFO", `listening on :${port}`, name);
      ctx.writeStdout(`${banner}\n`);
      for (const p of new Set([port, 80, 8080])) {
        ctx.listenHttp(p, async (_c, req) => { pushLog(ns, pod, "INFO", `${req.method} ${req.url.pathname} 200`, name); return { status: 200, body: `hello from ${name} (${pod})\n` }; });
      }
      return await ctx.waitUntilKilled();
    }
  };
}

export const genericImages: ImageConstructor[] = [
  genericImage("nginx", 80, "nginx/1.27 start worker processes"),
  genericImage("httpd", 80, "Apache/2.4 configured -- resuming normal operations"),
  genericImage("redis", 6379, "Ready to accept connections tcp"),
  genericImage("postgres", 5432, "database system is ready to accept connections"),
  genericImage("busybox", 80, "busybox httpd started"),
];
