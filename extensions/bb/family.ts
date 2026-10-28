import type { ThreadRow } from "./directory.js";

/** BB descendants follow parentThreadId; workflow workers instead have a lifecycle owner.
 * Close over both edges, once per thread, including nested workflows and cycles.
 */
export function withOwnedThreads(
  root: string,
  descendants: readonly string[],
  rows: readonly Pick<ThreadRow, "id" | "parentThreadId" | "lifecycleOwnerThreadId">[],
): string[] {
  const seen = new Set([root, ...descendants]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      if ((row.parentThreadId && seen.has(row.parentThreadId)) || (row.lifecycleOwnerThreadId && seen.has(row.lifecycleOwnerThreadId))) {
        seen.add(row.id);
        changed = true;
      }
    }
  }
  seen.delete(root);
  return [...seen];
}
