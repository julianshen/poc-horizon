// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ChatMarkdown } from "@/components/overlays/ChatMarkdown";

describe("ChatMarkdown (Streamdown)", () => {
  it("renders headings, paragraphs, and lists from markdown", async () => {
    render(
      <ChatMarkdown text={"# Title\n\nHello **world**.\n\n- one\n- two"} />,
    );
    await waitFor(() => expect(screen.getByText("Title")).toBeTruthy());
    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("two")).toBeTruthy();
  });

  it("renders fenced code blocks (Streamdown provides its own copy/download controls)", async () => {
    render(<ChatMarkdown text={"```ts\nconst x = 1;\n```"} />);
    // The exact glyphs come from Streamdown — we only assert the code text is present.
    await waitFor(() => expect(screen.getByText(/const x = 1/)).toBeTruthy());
  });

  it("isAnimating prop is accepted (drives Streamdown's built-in caret + partial-markdown tolerance)", () => {
    expect(() =>
      render(<ChatMarkdown text={"Streaming…"} isAnimating />),
    ).not.toThrow();
  });
});
