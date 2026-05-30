// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { setupRendererTest } from "../helpers/fakeHorizonAPI";
import { WorkflowsPopover } from "@/components/overlays/WorkflowsPopover";

describe("WorkflowsPopover — site skills section", () => {
  const { api } = setupRendererTest();

  it("lists site skills and removes one (refreshing the list)", async () => {
    let listCalls = 0;
    api().invoke.mockImplementation((channel: string) => {
      if (channel === "workflow:list") return Promise.resolve([]);
      if (channel === "domainSkill:list") {
        listCalls += 1;
        return Promise.resolve(
          listCalls === 1 ? [{ host: "example.com", names: ["search.md"] }] : [],
        );
      }
      return Promise.resolve(undefined);
    });
    render(<WorkflowsPopover onRun={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("search.md")).toBeTruthy());
    fireEvent.click(
      screen.getByRole("button", { name: "Delete site skill search.md for example.com" }),
    );
    await waitFor(() =>
      expect(api().invoke.mock.calls).toContainEqual([
        "domainSkill:remove",
        { host: "example.com", name: "search.md" },
      ]),
    );
    await waitFor(() => expect(screen.queryByText("search.md")).toBeNull());
  });
});
