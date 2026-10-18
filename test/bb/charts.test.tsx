// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AreaChart, BarChart } from "../../extensions/bb/charts.js";

afterEach(cleanup);

describe("charts", () => {
  it("draw one point per value and nothing for no values", () => {
    const { container } = render(<AreaChart values={[1, 2, 4]} />);
    expect(container.querySelector("polyline")?.getAttribute("points")?.split(" ")).toHaveLength(3);
    expect(render(<AreaChart values={[]} />).container.querySelector("svg")).toBeNull();
  });

  it("copes with a single or constant series", () => {
    expect(render(<AreaChart values={[3]} />).container.querySelector("polyline")).not.toBeNull();
    expect(render(<BarChart values={[0, 0]} />).container.querySelectorAll("rect")).toHaveLength(2);
  });

  it("draws one bar per value and emphasises the highlighted one", () => {
    const { container } = render(<BarChart values={[1, 2, 3]} highlight={2} />);
    const bars = [...container.querySelectorAll("rect")];
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => b.getAttribute("opacity"))).toEqual(["0.55", "0.55", "1"]);
  });
});
