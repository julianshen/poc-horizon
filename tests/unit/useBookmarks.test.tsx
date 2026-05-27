// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { useBookmarks } from "@/hooks/useBookmarks";

const bk = (id: string, url: string, title = id) => ({
  id,
  schemaVersion: 1,
  index: 0,
  title,
  url,
  dateAdded: 0,
});

const callsOn = (
  api: ReturnType<typeof setupRendererTest>["api"],
  channel: string,
) => api().invoke.mock.calls.filter((c) => c[0] === channel);

describe("useBookmarks", () => {
  const { api } = setupRendererTest();

  it("loads bookmarks on mount, filtering folders", async () => {
    api().invoke.mockResolvedValue([
      { id: "folder", schemaVersion: 1, index: 0, title: "Bar", dateAdded: 0 },
      bk("a", "https://a"),
    ]);
    const { result } = renderHook(() => useBookmarks());
    await waitFor(() => expect(result.current.bookmarks).toHaveLength(1));
    expect(result.current.bookmarks[0].id).toBe("a");
  });

  it("add() invokes bookmark:add", async () => {
    api().invoke.mockResolvedValue([bk("a", "https://a")]);
    const { result } = renderHook(() => useBookmarks());
    await waitFor(() => expect(result.current.bookmarks).toHaveLength(1));
    await act(async () => {
      await result.current.add("https://b", "B");
    });
    expect(callsOn(api, "bookmark:add")).toEqual([
      ["bookmark:add", { url: "https://b", title: "B" }],
    ]);
  });

  it("remove() invokes bookmark:remove", async () => {
    api().invoke.mockResolvedValue([bk("a", "https://a")]);
    const { result } = renderHook(() => useBookmarks());
    await waitFor(() => expect(result.current.bookmarks).toHaveLength(1));
    await act(async () => {
      await result.current.remove("a");
    });
    expect(callsOn(api, "bookmark:remove")).toEqual([
      ["bookmark:remove", { bookmarkId: "a" }],
    ]);
  });

  it("findByUrl returns the matching bookmark or undefined", async () => {
    api().invoke.mockResolvedValue([bk("a", "https://a")]);
    const { result } = renderHook(() => useBookmarks());
    await waitFor(() => expect(result.current.bookmarks).toHaveLength(1));
    expect(result.current.findByUrl("https://a")?.id).toBe("a");
    expect(result.current.findByUrl("https://missing")).toBeUndefined();
  });

  it("defaults to [] when the tree response is not an array", async () => {
    api().invoke.mockResolvedValue(null);
    const { result } = renderHook(() => useBookmarks());
    await waitFor(() =>
      expect(callsOn(api, "bookmark:getTree").length).toBeGreaterThan(0),
    );
    expect(result.current.bookmarks).toEqual([]);
  });
});
