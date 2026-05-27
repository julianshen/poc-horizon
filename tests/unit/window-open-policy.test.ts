import { describe, it, expect } from "vitest";
import { denyAllWindowOpens } from "@electron/services/windowOpenPolicy";

describe("windowOpenPolicy", () => {
  it("denies all window.open requests", () => {
    expect(denyAllWindowOpens()).toEqual({ action: "deny" });
  });

  it("is total — returns the same result on every call (no state)", () => {
    expect(denyAllWindowOpens()).toEqual(denyAllWindowOpens());
  });
});
