// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs, existsSync } from "fs";
import path from "path";

// Mock home path as a temporary directory inside the workspace so tests don't pollute real home
const mockHome = path.resolve(__dirname, "../../scratch/test-home");

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === "home") return mockHome;
      return "/fake-path";
    }),
  },
}));

import { writePiSkill } from "@electron/services/piSkillWriter";

describe("piSkillWriter", () => {
  beforeEach(async () => {
    await fs.mkdir(mockHome, { recursive: true }).catch(() => {});
  });

  afterEach(async () => {
    await fs.rm(mockHome, { recursive: true, force: true }).catch(() => {});
  });

  it("truncates llmsTxt to safe character limits", async () => {
    const origin = "https://news.google.com";
    const llmsTxt = "A".repeat(15000); // Exceeds 10,000 limit

    const filepath = await writePiSkill(origin, llmsTxt);
    expect(filepath).not.toBeNull();
    expect(existsSync(filepath!)).toBe(true);

    const writtenBody = await fs.readFile(filepath!, "utf8");

    // The written body should contain the safe truncated text and our safe truncation message
    expect(writtenBody).toContain("... [truncated to save token limit]");
    expect(writtenBody.indexOf("A".repeat(10000))).toBeGreaterThan(0);
    expect(writtenBody).not.toContain("A".repeat(10001)); // Should be truncated at exactly 10,000
  });

  it("does not include llmsFullTxt inside the generated skill", async () => {
    const origin = "https://news.google.com";
    const llmsTxt = "Sitemap index info";
    const llmsFullTxt = "Full reference documentation info";

    const filepath = await writePiSkill(origin, llmsTxt, llmsFullTxt);
    expect(filepath).not.toBeNull();
    expect(existsSync(filepath!)).toBe(true);

    const writtenBody = await fs.readFile(filepath!, "utf8");
    expect(writtenBody).toContain("Sitemap index info");
    expect(writtenBody).not.toContain("Full reference documentation info");
    expect(writtenBody).not.toContain("llms-full.txt");
  });
});
