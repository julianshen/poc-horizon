// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useIncognito } from "@/hooks/useIncognito";

const setSearch = (s: string): void => {
  // jsdom does not allow direct location.search assignment in all builds —
  // use history.replaceState instead.
  window.history.replaceState({}, "", "/" + s);
};

describe("useIncognito", () => {
  beforeEach(() => setSearch(""));
  afterEach(() => setSearch(""));

  it("returns false when there is no incognito flag", () => {
    expect(useIncognito()).toBe(false);
  });

  it("returns true when incognito=1", () => {
    setSearch("?incognito=1");
    expect(useIncognito()).toBe(true);
  });

  it("returns false for any other value", () => {
    setSearch("?incognito=0");
    expect(useIncognito()).toBe(false);
    setSearch("?incognito=true");
    expect(useIncognito()).toBe(false);
  });

  it("returns false for unrelated query params", () => {
    setSearch("?foo=bar");
    expect(useIncognito()).toBe(false);
  });
});
