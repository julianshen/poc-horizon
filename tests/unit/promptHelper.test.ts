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
});
