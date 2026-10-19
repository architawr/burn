import { ANTHROPIC_PRICES, OPENAI_CODEX_PRICES, type PriceTable } from "../../src/prices.js";

/** How Burn reads one bb provider's threads. */
export interface Harness {
  /** "pi-log": the Burn host entry reads pi's session logs; "events": the usage bb records. */
  reader: "pi-log" | "events";
  /** The list prices for tokens of a session that records no cost; null to show tokens. */
  prices: PriceTable | null;
  /** Whether inputTokens includes cached and cache-write tokens; null when unknown. */
  cacheInInput: boolean | null;
  // Each usage event is one model call, so price tiers and the stop apply.
  perCall: boolean;
}

const HARNESSES: Readonly<Record<string, Harness>> = {
  pi: { reader: "pi-log", prices: null, cacheInInput: false, perCall: true },
  codex: { reader: "events", prices: OPENAI_CODEX_PRICES, cacheInInput: true, perCall: true },
  "claude-code": { reader: "events", prices: ANTHROPIC_PRICES, cacheInInput: false, perCall: false },
};

const OTHER: Harness = { reader: "events", prices: null, cacheInInput: null, perCall: false };

export const harnessOf = (providerId: string): Harness => (Object.hasOwn(HARNESSES, providerId) ? (HARNESSES[providerId] as Harness) : OTHER);
