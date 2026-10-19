import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { describe, expect, it } from "vitest";
import { ANTHROPIC_PRICES, listCost, OPENAI_CODEX_PRICES, priceOf } from "../src/prices.js";

const chatCosts = (models: Record<string, { id: string; type?: string; cost: unknown }>) =>
  Object.fromEntries(
    Object.values(models)
      .filter((m) => m.type === "chat")
      .map((m) => [m.id, m.cost]),
  );

const tokens = (over: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }>) => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  ...over,
});

describe("price lists", () => {
  it("match pi's list prices for every Anthropic and OpenAI Codex chat model, with no extra ids", () => {
    expect(ANTHROPIC_PRICES).toEqual(chatCosts(ANTHROPIC_MODELS));
    expect(OPENAI_CODEX_PRICES).toEqual(chatCosts(OPENAI_CODEX_MODELS));
  });
});

describe("priceOf", () => {
  it("finds a model by id, or by its id without a trailing bracket", () => {
    expect(priceOf(ANTHROPIC_PRICES, "claude-opus-5-5")).toBe(ANTHROPIC_PRICES["claude-opus-5-5"]);
    expect(priceOf(ANTHROPIC_PRICES, "claude-opus-5-5[1m]")).toBe(ANTHROPIC_PRICES["claude-opus-5-5"]);
    expect(priceOf(OPENAI_CODEX_PRICES, "shopify/auto")).toBeNull();
  });
});

describe("listCost", () => {
  it("prices tokens in dollars per million", () => {
    const row = priceOf(ANTHROPIC_PRICES, "claude-opus-5-5")!;
    const cost = listCost(row, tokens({ input: 1_000_000, output: 1_000_000 }), { tiers: true });
    expect(cost).toEqual({ input: 4, output: 20, cacheRead: 0, cacheWrite: 0, total: 24 });
  });

  it("uses a price tier only when tiers are allowed", () => {
    const row = priceOf(OPENAI_CODEX_PRICES, "gpt-5.5")!;
    expect(listCost(row, tokens({ input: 300_000 }), { tiers: true }).input).toBeCloseTo(3);
    expect(listCost(row, tokens({ input: 300_000 }), { tiers: false }).input).toBeCloseTo(1.5);
  });

  it("counts cached tokens toward a tier, and stays below it at the threshold", () => {
    const row = priceOf(OPENAI_CODEX_PRICES, "gpt-5.5")!;
    expect(listCost(row, tokens({ input: 200_000, cacheRead: 100_000 }), { tiers: true }).input).toBeCloseTo(2);
    expect(listCost(row, tokens({ input: 272_000 }), { tiers: true }).input).toBeCloseTo(1.36);
  });
});
