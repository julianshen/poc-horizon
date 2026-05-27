// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { applySpellcheckToSession } from "@electron/services/spellcheck";
import type { Session } from "electron";

function fakeSession(available: string[]): {
  session: Session;
  calls: string[][];
} {
  const calls: string[][] = [];
  const session = {
    availableSpellCheckerLanguages: available,
    setSpellCheckerLanguages: vi.fn((langs: string[]) => calls.push(langs)),
  } as unknown as Session;
  return { session, calls };
}

describe("applySpellcheckToSession", () => {
  it("passes through languages that Chromium supports", () => {
    const { session, calls } = fakeSession(["en-US", "fr-FR", "es-ES"]);
    applySpellcheckToSession(session, ["en-US", "fr-FR"]);
    expect(calls).toEqual([["en-US", "fr-FR"]]);
  });

  it("filters out unknown languages to avoid Chromium throwing", () => {
    const { session, calls } = fakeSession(["en-US"]);
    applySpellcheckToSession(session, ["en-US", "kl-GL", "tlh-Latn"]);
    expect(calls).toEqual([["en-US"]]);
  });

  it("accepts an empty list (effectively disables spell-check)", () => {
    const { session, calls } = fakeSession(["en-US"]);
    applySpellcheckToSession(session, []);
    expect(calls).toEqual([[]]);
  });

  it("produces an empty call when every requested language is unsupported", () => {
    const { session, calls } = fakeSession(["en-US"]);
    applySpellcheckToSession(session, ["xx-YY", "kl-GL"]);
    expect(calls).toEqual([[]]);
  });
});
