import { useState } from "react";
import type { ClusterStore } from "../engine/store";
import { INTERNAL_ENV, SANDBOX, updateDeployment } from "../engine/actions";
import { nameOf, type Obj } from "../kubectl/resources";

interface Props { store: ClusterStore; o: Obj; ns: string; say: (text: string, bad?: boolean) => void }
interface Pair { name: string; value: string }

/** A small "kubectl edit" in a form: replicas, image (sandbox) and environment variables. */
export function EditTab({ store, o, ns, say }: Props) {
  const editable = ns === SANDBOX || ns === "incident-lab";
  const c = o.spec?.template?.spec?.containers?.[0] ?? {};
  const [replicas, setReplicas] = useState<number>(o.spec?.replicas ?? 1);
  const [image, setImage] = useState<string>(c.image ?? "");
  const [env, setEnv] = useState<Pair[]>(((c.env ?? []) as Pair[]).filter((e) => !INTERNAL_ENV.has(e.name)).map((e) => ({ name: e.name, value: e.value ?? "" })));
  const [busy, setBusy] = useState(false);
  const max = ns === SANDBOX ? 5 : 3;

  const apply = async () => {
    setBusy(true);
    try {
      await updateDeployment(store, ns, nameOf(o), { replicas, env, image: ns === SANDBOX ? image : undefined });
      say("Applied. Kubernetes is rolling out the change, watch the pods.");
    } catch (e) { say(String(e), true); }
    setBusy(false);
  };

  return (
    <div className="stack">
      {!editable && <p className="muted">This namespace is read-only. Editing is enabled in <span className="mono">incident-lab</span> and <span className="mono">sandbox</span>.</p>}
      {ns === "incident-lab" && <p className="muted">Something is wrong with this workload. Read its logs first, then change what it needs here.</p>}
      <div className="field">
        <label htmlFor="ed-rep">Replicas</label>
        <input id="ed-rep" type="number" min={0} max={max} value={replicas} disabled={!editable} onChange={(e) => setReplicas(Math.max(0, Math.min(max, Number(e.target.value) || 0)))} />
      </div>
      <div className="field">
        <label htmlFor="ed-img">Image</label>
        <input id="ed-img" value={image} disabled={ns !== SANDBOX} onChange={(e) => setImage(e.target.value)} spellCheck={false} />
      </div>
      <div>
        <h4 className="env-h">Environment variables</h4>
        {env.length === 0 && <p className="muted">None set.</p>}
        {env.map((p, i) => (
          <div className="env-row" key={i}>
            <input aria-label={`Variable ${i + 1} name`} placeholder="NAME" value={p.name} disabled={!editable} spellCheck={false} onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input aria-label={`Variable ${i + 1} value`} placeholder="value" value={p.value} disabled={!editable} spellCheck={false} onChange={(e) => setEnv(env.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button type="button" className="x" aria-label={`Remove variable ${i + 1}`} disabled={!editable} onClick={() => setEnv(env.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="chip" disabled={!editable} onClick={() => setEnv([...env, { name: "", value: "" }])}>+ add variable</button>
      </div>
      <div className="acts"><button type="button" className="primary-b" disabled={!editable || busy} onClick={apply}>{busy ? "Applying…" : "Apply changes"}</button></div>
    </div>
  );
}
