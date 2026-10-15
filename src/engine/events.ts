/** Tiny event bus between simulated images and the UI. */
export interface LabSolved { ns: string; pod: string; at: number }
export const labEvents = new EventTarget();

let solved = false;
export const resetLab = (): void => { solved = false; };
export function emitSolved(ns: string, pod: string): void {
  if (solved) return;
  solved = true;
  labEvents.dispatchEvent(new CustomEvent<LabSolved>("solved", { detail: { ns, pod, at: Date.now() } }));
}
