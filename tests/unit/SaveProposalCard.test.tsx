// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { SaveProposalCard } from "@/components/overlays/SaveProposalCard";

const skillProposal = {
  id: "save-1",
  kind: "skill" as const,
  name: "search-and-filter",
  content: "## Search\nUse the box.",
  host: "news.ycombinator.com",
};
const actionProposal = {
  id: "save-2",
  kind: "action" as const,
  name: "Search HN",
  content: "Search this site for {query}.",
  attach: "activeTab" as const,
};

describe("SaveProposalCard", () => {
  const { api } = setupRendererTest();

  it("renders nothing until a proposal arrives", () => {
    const { container } = render(<SaveProposalCard />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a skill proposal and saves via domainSkill:save with edited values", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", skillProposal));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api().invokes).toContainEqual({
      channel: "domainSkill:save",
      payload: { host: "news.ycombinator.com", name: "renamed", content: "## Search\nUse the box." },
    });
  });

  it("shows an action proposal and saves via workflow:create", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", actionProposal));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api().invokes).toContainEqual({
      channel: "workflow:create",
      payload: { name: "Search HN", prompt: "Search this site for {query}.", attach: "activeTab" },
    });
  });

  it("flips kind from skill to action and saves as a workflow", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", skillProposal));
    fireEvent.click(screen.getByRole("button", { name: "Reusable action" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(api().invokes.at(-1)).toEqual({
      channel: "workflow:create",
      payload: { name: "search-and-filter", prompt: "## Search\nUse the box.", attach: "activeTab" },
    });
  });

  it("Cancel dismisses without any IPC", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", skillProposal));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api().invokes.length).toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables Save when the name is empty", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", { ...skillProposal, name: "" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables Save for a skill with an empty host", async () => {
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", { ...skillProposal, host: "" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the card open and shows an error when the save IPC rejects", async () => {
    api().invoke.mockRejectedValueOnce(new Error("disk full"));
    render(<SaveProposalCard />);
    act(() => api().emit("ai:saveProposal", skillProposal));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("disk full");
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("queues FIFO — resolving the first reveals the second", async () => {
    render(<SaveProposalCard />);
    act(() => {
      api().emit("ai:saveProposal", skillProposal);
      api().emit("ai:saveProposal", actionProposal);
    });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("search-and-filter");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Search HN");
  });
});
