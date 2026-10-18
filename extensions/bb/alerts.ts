/** The realtime channel that carries a BurnAlert; the app overlay shows each one as a toast. */
export const ALERT_CHANNEL = "alert";

/**
 * Something worth telling the user once. The server writes the words, so
 * every window shows the same toast; `id` lets a window drop a repeat.
 */
export interface BurnAlert {
  id: string;
  kind: "near" | "over" | "stopped" | "expensive" | "daily";
  threadId: string | null;
  title: string;
  body: string;
  at: number;
}

export function isBurnAlert(payload: unknown): payload is BurnAlert {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    ["near", "over", "stopped", "expensive", "daily"].includes(p.kind as string) &&
    (p.threadId === null || typeof p.threadId === "string") &&
    typeof p.title === "string" &&
    typeof p.body === "string" &&
    typeof p.at === "number"
  );
}
