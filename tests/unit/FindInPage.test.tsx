// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FindInPage } from "@/components/overlays/FindInPage";
import { useBrowserStore } from "@/stores/browserStore";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";

describe("FindInPage", () => {
  const { api } = setupRendererTest();
  const initialState = useBrowserStore.getState();

  it("renders nothing when showFindBar is false", () => {
    const { container } = render(<FindInPage />);
    expect(container.firstChild).toBeNull();
  });

  it("renders when showFindBar is true", () => {
    useBrowserStore.setState({ ...initialState, showFindBar: true });
    render(<FindInPage />);
    expect(screen.getByPlaceholderText("Find in page")).toBeTruthy();
  });

  it("Enter (no shift) dispatches find:start + find:next forward", () => {
    useBrowserStore.setState({
      ...initialState,
      showFindBar: true,
      activeTabId: "t1",
    });
    render(<FindInPage />);
    const input = screen.getByPlaceholderText(
      "Find in page",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });
    expect(api().invokes).toEqual([
      { channel: "find:start", payload: { tabId: "t1", text: "hello" } },
      { channel: "find:next", payload: { tabId: "t1", forward: true } },
    ]);
  });

  it("Shift+Enter searches backwards", () => {
    useBrowserStore.setState({
      ...initialState,
      showFindBar: true,
      activeTabId: "t1",
    });
    render(<FindInPage />);
    const input = screen.getByPlaceholderText(
      "Find in page",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(api().invokes[1]).toEqual({
      channel: "find:next",
      payload: { tabId: "t1", forward: false },
    });
  });

  it("↑/↓ buttons search backward/forward", () => {
    useBrowserStore.setState({
      ...initialState,
      showFindBar: true,
      activeTabId: "t1",
    });
    render(<FindInPage />);
    const input = screen.getByPlaceholderText(
      "Find in page",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "q" } });
    fireEvent.click(screen.getByLabelText("Previous match"));
    expect(api().invokes.at(-1)).toEqual({
      channel: "find:next",
      payload: { tabId: "t1", forward: false },
    });
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(api().invokes.at(-1)).toEqual({
      channel: "find:next",
      payload: { tabId: "t1", forward: true },
    });
  });

  it("search is a no-op when input is empty", () => {
    useBrowserStore.setState({
      ...initialState,
      showFindBar: true,
      activeTabId: "t1",
    });
    render(<FindInPage />);
    const input = screen.getByPlaceholderText(
      "Find in page",
    ) as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api().invokes).toEqual([]);
  });

  it("search is a no-op when there is no active tab", () => {
    useBrowserStore.setState({
      ...initialState,
      showFindBar: true,
      activeTabId: null,
    });
    render(<FindInPage />);
    const input = screen.getByPlaceholderText(
      "Find in page",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "q" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(api().invokes).toEqual([]);
  });

  it("non-Enter keys do not trigger search", () => {
    useBrowserStore.setState({
      ...initialState,
      showFindBar: true,
      activeTabId: "t1",
    });
    render(<FindInPage />);
    const input = screen.getByPlaceholderText(
      "Find in page",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "q" } });
    fireEvent.keyDown(input, { key: "a" });
    expect(api().invokes).toEqual([]);
  });

  it("subscribes to find:result and renders match counts", () => {
    useBrowserStore.setState({
      ...initialState,
      showFindBar: true,
      activeTabId: "t1",
    });
    render(<FindInPage />);
    act(() => {
      api().emit("find:result", { matches: 7, activeMatchOrdinal: 3 });
    });
    expect(screen.getByText("3/7")).toBeTruthy();
  });

  it("✕ button closes the find bar via toggleOverlay", () => {
    useBrowserStore.setState({ ...initialState, showFindBar: true });
    render(<FindInPage />);
    fireEvent.click(screen.getByLabelText("Close find bar"));
    expect(useBrowserStore.getState().showFindBar).toBe(false);
  });
});
