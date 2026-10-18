import { experimental_copyToClipboard } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { summaryMarkdown } from "../../src/format.js";
import type { UsageReport } from "../../src/report.js";
import type { EffectiveBudget } from "./budgets.js";

/** Copies the thread's cost summary as Markdown and says whether it worked. */
export async function copySummary(report: UsageReport, title: string | null, budget: EffectiveBudget | null): Promise<boolean> {
  const text = summaryMarkdown(report, { title: title ?? undefined, budget: budget?.amount ?? null });
  const copied = await experimental_copyToClipboard({ text });
  if (copied) toast.success("Copied the cost summary");
  else toast.error("Copying the cost summary failed");
  return copied;
}
