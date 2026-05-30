// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { AIPanel } from "@/components/overlays/AIPanel";
import { useBrowserStore } from "@/stores/browserStore";

describe("AIPanel", () => {
  const { api } = setupRendererTest();

  it("renders the header and initial AI greeting", () => {
    render(<AIPanel />);
    expect(
      screen.getByRole("complementary", { name: "Horizon AI" }),
    ).toBeTruthy();
    expect(screen.getByText(/I can see the page you're reading/)).toBeTruthy();
  });

  it("Send button is disabled until the textarea has content", () => {
    render(<AIPanel />);
    const send = screen.getByRole("button", { name: "Send" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/), {
      target: { value: "hi" },
    });
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });

  it("Enter (no shift) submits and dispatches ai:start IPC with the prompt", async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "hello" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    // The "you" bubble renders immediately.
    expect(screen.getByText("hello")).toBeTruthy();
    // ai:start IPC fires with the prompt for the agent to take over.
    await waitFor(() => {
      expect(api().invokes).toContainEqual({
        channel: "ai:start",
        payload: { prompt: "hello" },
      });
    });
  });

  it("streams ai:event text_delta into the AI bubble", async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    act(() =>
      api().emit("ai:event", { type: "text_delta", text: "Hello back!" }),
    );
    await waitFor(() => expect(screen.getByText("Hello back!")).toBeTruthy());
    act(() => api().emit("ai:event", { type: "turn_end", reason: "stop" }));
  });

  it("renders tool_use chips in the AI bubble while the agent runs", async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "go" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    act(() =>
      api().emit("ai:event", {
        type: "tool_use",
        id: "t1",
        name: "navigate",
        input: { url: "https://x" },
      }),
    );
    await waitFor(() => expect(screen.getByText(/navigate/)).toBeTruthy());
    act(() =>
      api().emit("ai:event", {
        type: "tool_result",
        id: "t1",
        output: { ok: true },
      }),
    );
    act(() => api().emit("ai:event", { type: "turn_end", reason: "stop" }));
  });

  it("Stop button cancels the in-flight turn", () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "go" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    const stop = screen.getByText("Stop");
    fireEvent.click(stop);
    expect(api().invokes).toContainEqual({ channel: "ai:cancel", payload: {} });
  });

  it("New chat button fires ai:newChat and resets the message list", async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "first prompt" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(screen.getByText("first prompt")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("New chat"));
    expect(api().invokes).toContainEqual({
      channel: "ai:newChat",
      payload: {},
    });
    // After New chat, the prior user message is gone and we're back at INITIAL.
    expect(screen.queryByText("first prompt")).toBeNull();
    expect(screen.getByText(/I can see the page you're reading/)).toBeTruthy();
  });

  it("@-mention picker → pick → send dispatches ai:start with mentionTabIds", async () => {
    // Seed two tabs we can mention.
    useBrowserStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          id: "t1",
          schemaVersion: 1,
          url: "https://a.example",
          title: "Page A",
          isLoading: false,
          loadProgress: 0,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          isMuted: false,
          isActive: true,
          isHibernated: false,
          zoomLevel: 1,
          createdAt: 0,
          lastAccessedAt: 0,
        },
        {
          id: "t2",
          schemaVersion: 1,
          url: "https://b.example",
          title: "Page B",
          isLoading: false,
          loadProgress: 0,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          isMuted: false,
          isActive: false,
          isHibernated: false,
          zoomLevel: 1,
          createdAt: 0,
          lastAccessedAt: 0,
        },
      ],
    });
    render(<AIPanel />);
    fireEvent.click(screen.getByLabelText("Mention a tab"));
    expect(screen.getByTestId("mention-picker")).toBeTruthy();
    fireEvent.click(screen.getByText("Page B"));
    // Chip strip shows the picked tab.
    expect(screen.getByTestId("mention-chips").textContent).toContain("Page B");
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "compare them" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(api().invokes).toContainEqual({
      channel: "ai:start",
      payload: { prompt: "compare them", mentionTabIds: ["t2"] },
    });
  });

  it("a render_ui tool_result renders an A2UI surface inside the AI bubble", async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "show me a card" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    // Agent calls render_ui with a Heading inside a Card.
    act(() =>
      api().emit("ai:event", {
        type: "tool_use",
        id: "u1",
        name: "render_ui",
        input: { message: {} },
      }),
    );
    act(() =>
      api().emit("ai:event", {
        type: "tool_result",
        id: "u1",
        output: {
          beginRendering: { surfaceId: "s1", root: "card" },
        },
      }),
    );
    act(() =>
      api().emit("ai:event", {
        type: "tool_result",
        id: "u1",
        output: {
          surfaceUpdate: {
            surfaceId: "s1",
            components: [
              { id: "card", component: { Card: { child: "heading" } } },
              {
                id: "heading",
                component: {
                  Heading: { text: { literalString: "Hello A2UI" } },
                },
              },
            ],
          },
        },
      }),
    );
    await waitFor(() => expect(screen.getByText("Hello A2UI")).toBeTruthy());
    act(() => api().emit("ai:event", { type: "turn_end", reason: "stop" }));
  });

  it("Ask AI on selection prefills the draft (and the panel opens via the store hook in App)", async () => {
    // The pendingSelection field is normally set by the useAskFromSelection
    // hook in response to an IPC; we set it directly here.
    useBrowserStore.setState({
      activeTabId: "t1",
      pendingSelection: {
        selection: "recursion is when a function calls itself",
        pageUrl: "https://x",
        pageTitle: "Wiki",
      },
    });
    render(<AIPanel />);
    const ta = (await screen.findByPlaceholderText(
      /Ask anything/,
    )) as HTMLTextAreaElement;
    await waitFor(() =>
      expect(ta.value).toMatch(/Regarding this selection from "Wiki"/),
    );
    expect(ta.value).toContain("recursion is when a function calls itself");
  });

  it("AI bubble Copy button writes the message text to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<AIPanel />);
    // The INITIAL message has a known text — find its Copy button and click.
    const copyBtn = screen.getAllByLabelText("Copy AI response")[0];
    fireEvent.click(copyBtn);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toMatch(
      /I can see the page you're reading/,
    );
    await waitFor(() =>
      expect(screen.getAllByText("Copied").length).toBeGreaterThan(0),
    );
  });

  it("AI bubble Paste-to-page button dispatches ai:pasteToPage with the message text", async () => {
    api().invoke.mockImplementation(
      async (channel: string, payload: unknown) => {
        api().invokes.push({ channel, payload });
        if (channel === "ai:pasteToPage")
          return { ok: true, target: "textarea" };
        return undefined;
      },
    );
    render(<AIPanel />);
    const pasteBtn = screen.getAllByLabelText(
      /Paste AI response into the page/,
    )[0];
    fireEvent.click(pasteBtn);
    await waitFor(() => {
      const call = api().invokes.find((i) => i.channel === "ai:pasteToPage");
      expect(call).toBeTruthy();
      expect((call!.payload as { text: string }).text).toMatch(
        /I can see the page you're reading/,
      );
    });
  });

  it('AI bubble Paste shows "No input focused" when the page has no editable target', async () => {
    api().invoke.mockImplementation(
      async (channel: string, payload: unknown) => {
        api().invokes.push({ channel, payload });
        if (channel === "ai:pasteToPage")
          return { ok: false, reason: "no-focused-input" };
        return undefined;
      },
    );
    render(<AIPanel />);
    fireEvent.click(
      screen.getAllByLabelText(/Paste AI response into the page/)[0],
    );
    await waitFor(() =>
      expect(screen.getByText("No input focused")).toBeTruthy(),
    );
  });

  it("Workflows popover opens, loads list, and runs a workflow on click", async () => {
    useBrowserStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          id: "t1",
          schemaVersion: 1,
          url: "https://x",
          title: "X",
          isLoading: false,
          loadProgress: 0,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          isMuted: false,
          isActive: true,
          isHibernated: false,
          zoomLevel: 1,
          createdAt: 0,
          lastAccessedAt: 0,
        },
      ],
    });
    // Stub workflow:list to return a saved workflow; all other channels
    // fall through to the default fake's record-then-return-undefined.
    api().invoke.mockImplementation(
      async (channel: string, payload: unknown) => {
        api().invokes.push({ channel, payload });
        if (channel === "workflow:list") {
          return [
            {
              id: "w1",
              name: "Daily Brief",
              prompt: "Brief me.",
              attach: "activeTab",
              createdAt: 0,
            },
          ];
        }
        return undefined;
      },
    );
    render(<AIPanel />);
    fireEvent.click(screen.getByLabelText("Workflows"));
    expect(screen.getByTestId("workflows-popover")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Daily Brief")).toBeTruthy());
    fireEvent.click(screen.getByText("Daily Brief"));
    expect(api().invokes).toContainEqual({
      channel: "ai:start",
      payload: { prompt: "Brief me.", mentionTabIds: ["t1"] },
    });
  });

  it("Summarize header button auto-mentions the active tab and sends a canned prompt", () => {
    useBrowserStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          id: "t1",
          schemaVersion: 1,
          url: "https://x",
          title: "Some Page",
          isLoading: false,
          loadProgress: 0,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          isMuted: false,
          isActive: true,
          isHibernated: false,
          zoomLevel: 1,
          createdAt: 0,
          lastAccessedAt: 0,
        },
      ],
    });
    render(<AIPanel />);
    fireEvent.click(screen.getByLabelText("Summarize this page"));
    const call = api().invokes.find((i) => i.channel === "ai:start");
    expect(call).toBeTruthy();
    expect((call!.payload as { prompt: string }).prompt).toMatch(
      /Summarize the page I @-mentioned/,
    );
    expect(
      (call!.payload as { mentionTabIds: string[] }).mentionTabIds,
    ).toEqual(["t1"]);
  });

  it('Followup chip "Compare my open tabs" auto-mentions every tab', () => {
    useBrowserStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          id: "t1",
          schemaVersion: 1,
          url: "https://a",
          title: "A",
          isLoading: false,
          loadProgress: 0,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          isMuted: false,
          isActive: true,
          isHibernated: false,
          zoomLevel: 1,
          createdAt: 0,
          lastAccessedAt: 0,
        },
        {
          id: "t2",
          schemaVersion: 1,
          url: "https://b",
          title: "B",
          isLoading: false,
          loadProgress: 0,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          isMuted: false,
          isActive: false,
          isHibernated: false,
          zoomLevel: 1,
          createdAt: 0,
          lastAccessedAt: 0,
        },
      ],
    });
    render(<AIPanel />);
    fireEvent.click(screen.getByText("Compare my open tabs"));
    const call = api().invokes.find((i) => i.channel === "ai:start");
    expect(
      (call!.payload as { mentionTabIds: string[] }).mentionTabIds.sort(),
    ).toEqual(["t1", "t2"]);
  });

  it("pending llms.txt guides drain into a system card with site sections + links", async () => {
    useBrowserStore.setState({
      activeTabId: "t1",
      pendingLlmsGuides: [
        {
          origin: "https://fastapi.example",
          title: "FastAPI",
          summary: "A modern, fast web framework.",
          sections: [
            {
              name: "Getting Started",
              links: [
                {
                  title: "Installation",
                  url: "https://fastapi.example/install",
                  description: "pip install fastapi",
                },
              ],
            },
          ],
          hasFull: true,
          skillFile: "/tmp/skill.md",
        },
      ],
    });
    render(<AIPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("llms-guide-card")).toBeTruthy(),
    );
    expect(screen.getByText(/Site guide: FastAPI/)).toBeTruthy();
    expect(screen.getByText(/A modern, fast web framework/)).toBeTruthy();
    expect(screen.getByText("Installation")).toBeTruthy();
    expect(screen.getByText(/Skill saved for the Pi agent/)).toBeTruthy();
    // Clicking a section link dispatches navigation:go for the active tab.
    fireEvent.click(screen.getByText("Installation"));
    expect(api().invokes).toContainEqual({
      channel: "navigation:go",
      payload: { tabId: "t1", url: "https://fastapi.example/install" },
    });
  });

  it("render_ui accepts a flat {root, components} shape (LLM shortcut)", async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "flat shape" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    act(() =>
      api().emit("ai:event", {
        type: "tool_use",
        id: "u2",
        name: "render_ui",
        input: { message: {} },
      }),
    );
    act(() =>
      api().emit("ai:event", {
        type: "tool_result",
        id: "u2",
        output: JSON.stringify({
          root: "h",
          components: [
            {
              id: "h",
              component: {
                Heading: { text: { literalString: "Flat shortcut" } },
              },
            },
          ],
        }),
      }),
    );
    await waitFor(() => expect(screen.getByText("Flat shortcut")).toBeTruthy());
    act(() => api().emit("ai:event", { type: "turn_end", reason: "stop" }));
  });

  it("render_ui falls back to first component when root is unspecified", async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "no root" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    act(() =>
      api().emit("ai:event", {
        type: "tool_use",
        id: "u3",
        name: "render_ui",
        input: { message: {} },
      }),
    );
    act(() =>
      api().emit("ai:event", {
        type: "tool_result",
        id: "u3",
        output: {
          components: [
            {
              id: "only",
              component: { Text: { text: { literalString: "Auto-rooted" } } },
            },
          ],
        },
      }),
    );
    await waitFor(() => expect(screen.getByText("Auto-rooted")).toBeTruthy());
    act(() => api().emit("ai:event", { type: "turn_end", reason: "stop" }));
  });

  it("render_ui extracts the surface from tool.input when output is opaque", async () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(/Ask anything/);
    fireEvent.change(ta, { target: { value: "input-only" } });
    fireEvent.keyDown(ta, { key: "Enter" });
    act(() =>
      api().emit("ai:event", {
        type: "tool_use",
        id: "u4",
        name: "render_ui",
        input: {
          message: {
            root: "x",
            components: [
              {
                id: "x",
                component: { Text: { text: { literalString: "From input" } } },
              },
            ],
          },
        },
      }),
    );
    // Pi sometimes returns just {ok:true} for our echo tool — surface
    // should still render because we also inspect tool.input.
    act(() =>
      api().emit("ai:event", {
        type: "tool_result",
        id: "u4",
        output: { ok: true },
      }),
    );
    await waitFor(() => expect(screen.getByText("From input")).toBeTruthy());
    act(() => api().emit("ai:event", { type: "turn_end", reason: "stop" }));
  });

  it("mention chip × button removes the mention before send", async () => {
    useBrowserStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          id: "t1",
          schemaVersion: 1,
          url: "https://a.example",
          title: "Wikipedia",
          isLoading: false,
          loadProgress: 0,
          canGoBack: false,
          canGoForward: false,
          isPinned: false,
          isMuted: false,
          isActive: true,
          isHibernated: false,
          zoomLevel: 1,
          createdAt: 0,
          lastAccessedAt: 0,
        },
      ],
    });
    render(<AIPanel />);
    fireEvent.click(screen.getByLabelText("Mention a tab"));
    fireEvent.click(screen.getByText("Wikipedia"));
    fireEvent.click(screen.getByLabelText("Remove mention Wikipedia"));
    expect(screen.queryByTestId("mention-chips")).toBeNull();
  });

  it("Shift+Enter does not submit (the draft stays in the textarea)", () => {
    render(<AIPanel />);
    const ta = screen.getByPlaceholderText(
      /Ask anything/,
    ) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "one" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    // send() would have cleared the textarea on Enter; with shift held,
    // the draft must remain intact.
    expect(ta.value).toBe("one");
  });

  it("drains pendingLearnRequest → ai:start with the learn prompt, then clears the flag", async () => {
    render(<AIPanel />);
    act(() => {
      useBrowserStore.getState().requestLearnPage();
    });
    await waitFor(() => {
      const start = api().invokes.find((i) => i.channel === "ai:start");
      expect(start).toBeTruthy();
      expect((start!.payload as { prompt: string }).prompt).toContain(
        "browser_learn_page_actions",
      );
    });
    expect(useBrowserStore.getState().pendingLearnRequest).toBe(false);
  });

  it("header 'Learn this page's actions' button dispatches the learn prompt", async () => {
    render(<AIPanel />);
    fireEvent.click(
      screen.getByRole("button", { name: "Learn this page's actions" }),
    );
    await waitFor(() => {
      const start = api().invokes.find((i) => i.channel === "ai:start");
      expect((start!.payload as { prompt: string }).prompt).toContain(
        "browser_learn_page_actions",
      );
    });
  });

  it("does not start a learn turn while another turn is running", async () => {
    render(<AIPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/), {
      target: { value: "hi" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText(/Ask anything/), {
      key: "Enter",
    });
    await waitFor(() =>
      expect(
        api().invokes.filter((i) => i.channel === "ai:start").length,
      ).toBe(1),
    );
    // Precondition: a turn is in progress, so the header learn button is disabled.
    expect(
      (
        screen.getByRole("button", {
          name: "Learn this page's actions",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    act(() => {
      useBrowserStore.getState().requestLearnPage();
    });
    await waitFor(() =>
      expect(useBrowserStore.getState().pendingLearnRequest).toBe(false),
    );
    expect(api().invokes.filter((i) => i.channel === "ai:start").length).toBe(1);
  });

  // Suppress unused import warning.
  void api;
});
