import { useEffect, useRef } from "react";

const mm = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;

export function Solved({ seconds, onClose }: { seconds: number; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="solved-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="solved-title">Fixed. You passed the interview.</h2>
        <p>The worker is connected to Postgres and the pager stayed quiet. Congratulations, the roles just reversed: you debugged a broken workload, and now it is my turn to ask you the questions.</p>
        <ul className="score">
          <li><span>Read the logs before guessing</span><b>PASS</b></li>
          <li><span>Found the root cause</span><b>PASS</b></li>
          <li><span>Fixed it without breaking anything else</span><b>PASS</b></li>
          <li><span>Time to resolution</span><b>{mm(seconds)}</b></li>
        </ul>
        <div className="modal-acts">
          <a className="btn primary" href="mailto:jaroslav.gryczan@gmail.com?subject=Let%27s%20talk%20about%20the%20role">Let's talk</a>
          <button ref={btn} className="btn" onClick={onClose}>Back to the cluster</button>
        </div>
      </div>
    </div>
  );
}
