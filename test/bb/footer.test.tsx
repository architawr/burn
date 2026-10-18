// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FOOTER_SELECTOR, placeInFooter, useFooterMount } from "../../extensions/bb/footer.js";

function pane(): { pane: HTMLElement; group: HTMLElement; circle: HTMLElement; footer: HTMLElement } {
  const root = document.createElement("div");
  root.setAttribute("data-split-pane-id", "p1");
  const footer = document.createElement("div");
  footer.setAttribute("data-follow-up-composer-footer", "");
  const left = document.createElement("div");
  const group = document.createElement("div");
  const circle = document.createElement("button");
  circle.setAttribute("aria-label", "Context window 12% used");
  group.append(circle);
  footer.append(left, group);
  root.append(footer);
  document.body.append(root);
  return { pane: root, group, circle, footer };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("placeInFooter", () => {
  it("puts the node before the context circle", () => {
    const p = pane();
    const node = document.createElement("span");
    expect(placeInFooter(node, p.pane)).toBe(true);
    expect(node.nextElementSibling).toBe(p.circle);
    expect(FOOTER_SELECTOR).toBe("[data-follow-up-composer-footer]");
  });

  it("does not move a node that is already in the group", () => {
    const p = pane();
    const node = document.createElement("span");
    const other = document.createElement("span");
    p.group.insertBefore(node, p.circle);
    p.group.insertBefore(other, p.circle);
    expect(placeInFooter(node, p.pane)).toBe(true);
    expect([...p.group.children]).toEqual([node, other, p.circle]);
  });

  it("removes the node and says false when the pane has no footer", () => {
    const empty = document.createElement("div");
    const node = document.createElement("span");
    empty.append(node);
    expect(placeInFooter(node, empty)).toBe(false);
    expect(node.isConnected).toBe(false);
  });
});

describe("useFooterMount", () => {
  it("mounts in the footer of the anchor's pane and follows a re-render of the footer", async () => {
    const p = pane();
    const anchor = document.createElement("span");
    p.pane.append(anchor);
    const { result } = renderHook(() => useFooterMount(anchor));
    expect(result.current?.hasAttribute("data-burn-chip")).toBe(true);
    // The build scopes the plugin's utilities to plugin roots; the footer is outside the slot's own.
    expect(result.current?.hasAttribute("data-bb-plugin-root")).toBe(true);
    expect(result.current?.parentElement).toBe(p.group);

    const mount = result.current as HTMLElement;
    p.footer.remove();
    const next = pane();
    p.pane.append(next.footer);
    next.pane.remove();
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(mount.parentElement).toBe(next.footer.lastElementChild);
  });

  it("is null without an anchor or a pane", () => {
    const { result } = renderHook(() => useFooterMount(null));
    expect(result.current).toBeNull();
    const loose = document.createElement("span");
    document.body.append(loose);
    const { result: second } = renderHook(() => {
      const [anchor] = useState(loose);
      return useFooterMount(anchor);
    });
    expect(second.current).toBeNull();
  });
});
