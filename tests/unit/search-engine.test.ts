import { describe, it, expect } from "vitest";
import { SEARCH_ENGINES } from "@shared/constants";

describe("SEARCH_ENGINES", () => {
  it("every engine uses the {query} placeholder in its url template", () => {
    for (const [name, engine] of Object.entries(SEARCH_ENGINES)) {
      expect(engine.url, `${name}.url`).toContain("{query}");
    }
  });
});
