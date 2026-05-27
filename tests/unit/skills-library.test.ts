// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { SkillsLibrary } from "@electron/services/SkillsLibrary";

describe("SkillsLibrary (bundled skills)", () => {
  let lib: SkillsLibrary;
  beforeAll(() => {
    // Points at the actual bundled skills shipped in resources/.
    lib = new SkillsLibrary(
      path.join(__dirname, "../../resources/pi-extension/skills"),
    );
  });

  it("preamble() returns SKILL.md with the tool catalog", async () => {
    const body = await lib.preamble();
    expect(body).toContain("horizon-browser");
    expect(body).toContain("browser_navigate");
    expect(body).toContain("browser_save_helper");
  });

  it("listInteractions() returns every interaction-skill file, sorted", async () => {
    const files = await lib.listInteractions();
    expect(files).toContain("dropdowns.md");
    expect(files).toContain("iframes.md");
    expect(files).toContain("helpers.md");
    expect(files).toEqual([...files].sort());
  });

  it("readInteraction() returns the file body", async () => {
    const body = await lib.readInteraction("iframes.md");
    expect(body).toContain("Iframes");
  });

  it("readInteraction() returns null when name is unknown", async () => {
    expect(await lib.readInteraction("does-not-exist.md")).toBeNull();
  });

  it("readInteraction() rejects path traversal attempts", async () => {
    await expect(lib.readInteraction("../../SKILL.md")).rejects.toThrow(
      /invalid/,
    );
    await expect(lib.readInteraction("no-extension")).rejects.toThrow(
      /invalid/,
    );
  });
});
