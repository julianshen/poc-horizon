// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { AiActionPrompt } from "@/components/overlays/AiActionPrompt";

const emit = (
  api: ReturnType<typeof setupRendererTest>["api"],
  p: {
    id: string;
    tool: string;
    summary: string;
    args?: Record<string, unknown>;
  },
): void => {
  api().emit("ai:actionPrompt", { args: {}, ...p });
};

describe("AiActionPrompt", () => {
  const { api } = setupRendererTest();

  it("renders nothing until an ai:actionPrompt arrives", () => {
    render(<AiActionPrompt />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the tool name and the summary on prompt", () => {
    render(<AiActionPrompt />);
    act(() =>
      emit(api, { id: "a1", tool: "click", summary: "Click at (100, 50)" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Agent action approval" }),
    ).toBeTruthy();
    expect(screen.getByText(/click/)).toBeTruthy();
    expect(screen.getByText("Click at (100, 50)")).toBeTruthy();
  });

  it("Allow sends ai:actionDecide { allow: true } and clears the prompt", () => {
    render(<AiActionPrompt />);
    act(() =>
      emit(api, {
        id: "a2",
        tool: "navigate",
        summary: "Navigate to https://x",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(api().invokes).toEqual([
      { channel: "ai:actionDecide", payload: { id: "a2", allow: true } },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Block sends ai:actionDecide { allow: false } and clears the prompt", () => {
    render(<AiActionPrompt />);
    act(() =>
      emit(api, {
        id: "a3",
        tool: "evaluate",
        summary: "Run JS: window.x = 1",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    expect(api().invokes).toEqual([
      { channel: "ai:actionDecide", payload: { id: "a3", allow: false } },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it('queues a second prompt and shows "+N more" while the first is open', () => {
    render(<AiActionPrompt />);
    act(() =>
      emit(api, { id: "q1", tool: "click", summary: "Click at (1, 1)" }),
    );
    act(() => emit(api, { id: "q2", tool: "type", summary: "Type hello…" }));
    expect(screen.getByText("Click at (1, 1)")).toBeTruthy();
    expect(screen.getByText(/\+1 more/)).toBeTruthy();
  });

  it("advances to the next queued prompt after the first is decided", () => {
    render(<AiActionPrompt />);
    act(() =>
      emit(api, { id: "q1", tool: "click", summary: "Click at (1, 1)" }),
    );
    act(() => emit(api, { id: "q2", tool: "type", summary: "Type hello…" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    expect(screen.getByText("Type hello…")).toBeTruthy();
    expect(api().invokes).toEqual([
      { channel: "ai:actionDecide", payload: { id: "q1", allow: true } },
    ]);
  });
});
