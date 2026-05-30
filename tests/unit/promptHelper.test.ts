// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildAugmentedPrompt } from "@electron/services/promptHelper";

describe("promptHelper", () => {
  it("builds the augmented prompt with truncated site skills", () => {
    const prompt = "hello agent";
    const origin = "https://news.google.com";
    const massiveSkills = "S".repeat(30000); // exceeds 15,000 limit

    const augmented = buildAugmentedPrompt({
      prompt,
      skills: massiveSkills,
      origin,
    });

    expect(augmented).toContain(`<site-skills origin="${origin}">`);
    expect(augmented).toContain("... [truncated to save token limit]");
    expect(augmented).toContain("S".repeat(15000));
    expect(augmented).not.toContain("S".repeat(15001));
    expect(augmented).toContain("hello agent");
  });

  it("bounds TOTAL @-mentioned page content across tabs (not just per-page)", () => {
    // 10 tabs, each 30k chars (the per-page cap) → 300k total without an
    // aggregate budget. With the 60k total cap, only the budget's worth lands
    // and the rest are explicitly noted as omitted.
    const pages = Array.from({ length: 10 }, (_, i) => ({
      url: `https://x/${i}`,
      title: `t${i}`,
      text: "P".repeat(30_000),
      cap: 30_000,
    }));
    const augmented = buildAugmentedPrompt({
      prompt: "go",
      pages,
      pagesTotalCap: 60_000,
    });
    // Total page payload stays near the 60k budget, not 300k.
    expect(augmented.length).toBeLessThan(90_000);
    expect(augmented).toContain("omitted to stay within the token budget");
    expect(augmented).toContain("go");
  });

  it("does not add an omission note when all pages fit the budget", () => {
    const augmented = buildAugmentedPrompt({
      prompt: "go",
      pages: [{ url: "https://x", title: "t", text: "short", cap: 30_000 }],
      pagesTotalCap: 60_000,
    });
    expect(augmented).not.toContain("omitted to stay within");
    expect(augmented).toContain("short");
  });
});
