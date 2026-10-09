import { describe, expect, it } from "vitest";
import { pageItems } from "./page-items";

describe("pageItems", () => {
  it("lists every page when there are seven or fewer", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("shows the start and the last page on the first page", () => {
    expect(pageItems(1, 13)).toEqual([1, 2, 3, "gap", 13]);
  });

  it("shows the neighbours with gaps on both sides in the middle", () => {
    expect(pageItems(7, 13)).toEqual([1, "gap", 6, 7, 8, "gap", 13]);
  });

  it("shows the end and the first page on the last page", () => {
    expect(pageItems(13, 13)).toEqual([1, "gap", 11, 12, 13]);
  });

  it("never emits a gap between adjacent pages", () => {
    expect(pageItems(3, 13)).toEqual([1, 2, 3, 4, "gap", 13]);
    expect(pageItems(11, 13)).toEqual([1, "gap", 10, 11, 12, 13]);
  });
});
