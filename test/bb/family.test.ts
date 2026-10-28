import { expect, it } from "vitest";
import { withOwnedThreads } from "../../extensions/bb/family.js";
it("includes lifecycle workers, nested workflows and their parented descendants exactly once", () => {
  const rows = [
    { id: "nested", lifecycleOwnerThreadId: "worker" },
    { id: "worker", lifecycleOwnerThreadId: "root" },
    { id: "child", parentThreadId: "worker" },
    { id: "root", parentThreadId: "nested" },
    { id: "other", lifecycleOwnerThreadId: "unrelated" },
  ];
  expect(withOwnedThreads("root", ["regular", "worker"], rows).sort()).toEqual(["child", "nested", "regular", "worker"]);
});
