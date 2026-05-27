// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { useDownloads } from "@/hooks/useDownloads";

const item = (
  id: string,
  state: "progressing" | "completed" = "progressing",
) => ({
  id,
  filename: `${id}.bin`,
  url: "https://a",
  totalBytes: 100,
  receivedBytes: 50,
  state,
  startTime: 0,
  savePath: `/tmp/${id}`,
});

describe("useDownloads", () => {
  const { api } = setupRendererTest();

  it("upserts download:created and download:updated events", () => {
    const { result } = renderHook(() => useDownloads());
    act(() => api().emit("download:created", item("a")));
    expect(result.current.downloads).toHaveLength(1);
    act(() =>
      api().emit("download:updated", { ...item("a"), receivedBytes: 75 }),
    );
    expect(result.current.downloads[0].receivedBytes).toBe(75);
  });

  it("upserts download:completed and download:failed events", () => {
    const { result } = renderHook(() => useDownloads());
    act(() => api().emit("download:created", item("a")));
    act(() => api().emit("download:completed", item("a", "completed")));
    expect(result.current.downloads[0].state).toBe("completed");
    act(() =>
      api().emit("download:failed", {
        ...item("b"),
        state: "interrupted" as const,
      }),
    );
    expect(result.current.downloads.find((d) => d.id === "b")?.state).toBe(
      "interrupted",
    );
  });

  it("cancel/open/showInFolder invoke matching IPC channels", () => {
    const { result } = renderHook(() => useDownloads());
    result.current.cancel("a");
    result.current.open("b");
    result.current.showInFolder("c");
    expect(api().invokes).toEqual([
      { channel: "download:cancel", payload: { downloadId: "a" } },
      { channel: "download:open", payload: { downloadId: "b" } },
      { channel: "download:showInFolder", payload: { downloadId: "c" } },
    ]);
  });

  it("clearCompleted invokes IPC and removes non-progressing items locally", () => {
    const { result } = renderHook(() => useDownloads());
    act(() => api().emit("download:created", item("a", "progressing")));
    act(() => api().emit("download:created", item("b", "completed")));
    act(() => result.current.clearCompleted());
    expect(result.current.downloads.map((d) => d.id)).toEqual(["a"]);
    expect(
      api().invokes.some((i) => i.channel === "download:clearCompleted"),
    ).toBe(true);
  });
});
