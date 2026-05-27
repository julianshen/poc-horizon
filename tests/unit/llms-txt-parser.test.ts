// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseLlmsTxt } from "@electron/services/llmsTxtParser";

describe("parseLlmsTxt", () => {
  it("extracts title, summary, sections and links", () => {
    const src = [
      "# FastAPI",
      "",
      "> A modern, fast web framework for building APIs with Python.",
      "",
      "Some intro text we ignore.",
      "",
      "## Getting Started",
      "",
      "- [Installation](https://fastapi.tiangolo.com/#installation): pip install fastapi",
      "- [First Steps](https://fastapi.tiangolo.com/tutorial/first-steps/)",
      "",
      "## Reference",
      "",
      "- [API Reference](https://fastapi.tiangolo.com/reference/)",
    ].join("\n");
    const parsed = parseLlmsTxt(src);
    expect(parsed.title).toBe("FastAPI");
    expect(parsed.summary).toBe(
      "A modern, fast web framework for building APIs with Python.",
    );
    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0]).toEqual({
      name: "Getting Started",
      links: [
        {
          title: "Installation",
          url: "https://fastapi.tiangolo.com/#installation",
          description: "pip install fastapi",
        },
        {
          title: "First Steps",
          url: "https://fastapi.tiangolo.com/tutorial/first-steps/",
        },
      ],
    });
    expect(parsed.sections[1].name).toBe("Reference");
  });

  it("tolerates missing summary / sections", () => {
    const parsed = parseLlmsTxt("# Just a title\n");
    expect(parsed.title).toBe("Just a title");
    expect(parsed.summary).toBeUndefined();
    expect(parsed.sections).toEqual([]);
  });

  it("groups bullet links before any section under an empty-name section", () => {
    const parsed = parseLlmsTxt("# X\n\n- [a](http://a)\n- [b](http://b)");
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].name).toBe("");
    expect(parsed.sections[0].links.map((l) => l.title)).toEqual(["a", "b"]);
  });

  it("only counts the first H1 and first blockquote as title/summary", () => {
    const parsed = parseLlmsTxt("# First\n# Second\n> first\n> second");
    expect(parsed.title).toBe("First");
    expect(parsed.summary).toBe("first");
  });

  it("drops empty trailing sections (## with no links)", () => {
    const parsed = parseLlmsTxt("# X\n## Empty\n## Other\n- [a](http://a)");
    expect(parsed.sections.map((s) => s.name)).toEqual(["Other"]);
  });
});
