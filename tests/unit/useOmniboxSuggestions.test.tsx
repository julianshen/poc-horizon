// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { useOmniboxSuggestions } from "@/hooks/useOmniboxSuggestions";

const entry = (id: string) => ({
  id,
  url: `https://${id}`,
  title: id.toUpperCase(),
  visitTime: 0,
  visitCount: 1,
  typedCount: 0,
});

describe("useOmniboxSuggestions", () => {
  const { api } = setupRendererTest();

  it("returns no results when disabled", async () => {
    const { result } = renderHook(() => useOmniboxSuggestions("foo", false));
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current).toEqual([]);
    expect(api().invokes).toEqual([]);
  });

  it("returns no results for blank query even when enabled", async () => {
    const { result } = renderHook(() => useOmniboxSuggestions("   ", true));
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current).toEqual([]);
    expect(api().invokes).toEqual([]);
  });

  it("debounces and invokes history:search when enabled with a query", async () => {
    api().invoke.mockResolvedValue([entry("a")]);
    const { result } = renderHook(() => useOmniboxSuggestions("a", true));
    await waitFor(() => expect(result.current).toEqual([entry("a")]));
  });

  it("returns [] when the IPC call rejects", async () => {
    api().invoke.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useOmniboxSuggestions("a", true));
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current).toEqual([]);
  });

  it("falls back to [] when the IPC result is not an array", async () => {
    api().invoke.mockResolvedValue("not-an-array" as unknown);
    const { result } = renderHook(() => useOmniboxSuggestions("a", true));
    await new Promise((r) => setTimeout(r, 200));
    expect(result.current).toEqual([]);
  });

  it("updates results when the query changes", async () => {
    api().invoke.mockImplementation(
      (_channel: string, payload: { query: string }) =>
        Promise.resolve([entry(payload.query)]),
    );
    const { result, rerender } = renderHook(
      ({ q }) => useOmniboxSuggestions(q, true),
      {
        initialProps: { q: "a" },
      },
    );
    await waitFor(() => expect(result.current[0]?.id).toBe("a"));
    rerender({ q: "b" });
    await waitFor(() => expect(result.current[0]?.id).toBe("b"));
  });
});
