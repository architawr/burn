import { useRpc } from "@get-bb/plugin-sdk/app";
import { type FormEvent, type ReactNode, useState } from "react";
import { parseBudget } from "../../src/budget.js";
import { formatBudget } from "../../src/format.js";
import type { EffectiveBudget } from "./budgets.js";
import { Button } from "./components/ui/button.js";
import type { rpcContract } from "./contract.js";
import { errorText } from "./usage.js";

/**
 * Sets this thread's own budget: Save takes dollars (empty means none), Use
 * default follows the Thread budget setting again, Clear means no budget even
 * when the setting has one.
 */
export function BudgetEditor({
  threadId,
  budget,
  defaultBudget,
  autoFocus = false,
  onDone,
}: {
  threadId: string;
  budget: EffectiveBudget | null;
  defaultBudget: number | null;
  autoFocus?: boolean;
  onDone?: () => void;
}): ReactNode {
  const rpc = useRpc<typeof rpcContract>();
  const [text, setText] = useState(budget?.source === "thread" ? String(budget.amount) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = (value: number | null | "default"): void => {
    setBusy(true);
    rpc.call("setBudget", { threadId, budget: value }).then(
      () => {
        setBusy(false);
        setError(null);
        onDone?.();
      },
      (cause: unknown) => {
        setBusy(false);
        setError(`Saving the budget failed: ${errorText(cause)}`);
      },
    );
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const parsed = parseBudget(text);
    if (parsed === undefined) setError("Enter dollars, such as 10 or 7.50.");
    else save(parsed);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5 text-xs" aria-label="Thread budget" data-testid="budget-editor">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="flex h-7 items-center overflow-hidden rounded-md border border-border focus-within:ring-1 focus-within:ring-ring">
          <span className="grid h-full place-items-center border-r border-border bg-surface-recessed px-2 text-muted-foreground">$</span>
          <input
            aria-label="Budget in dollars"
            inputMode="decimal"
            autoComplete="off"
            autoFocus={autoFocus}
            value={text}
            placeholder={defaultBudget === null ? "none" : String(defaultBudget)}
            onChange={(event) => setText(event.target.value)}
            className="h-full w-20 bg-transparent px-2 tabular-nums outline-none placeholder:text-subtle-foreground"
          />
        </label>
        <Button type="submit" variant="primary" disabled={busy}>
          Save
        </Button>
        <Button disabled={busy} onClick={() => save("default")}>
          Use default
        </Button>
        <Button disabled={busy} onClick={() => save(null)}>
          Clear
        </Button>
      </div>
      <p className="text-muted-foreground">
        Use default follows the Thread budget setting ({defaultBudget === null ? "none set" : formatBudget(defaultBudget)}). Clear sets no
        budget for this thread.
      </p>
      {error !== null ? (
        <p role="alert" className="text-destructive-text">
          {error}
        </p>
      ) : null}
    </form>
  );
}
