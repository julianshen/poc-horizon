import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { AutofillManager } from "@electron/services/AutofillManager";
import type { SavedAddress } from "../../src/types/browser";
import { useTmpDir } from "../helpers/tmpdir";

const tmp = useTmpDir("horizon-autofill");
const addressesPath = () => tmp.path("addresses.json");

const sampleAddress = (id = ""): SavedAddress => ({
  id,
  label: "Home",
  name: "Alice Example",
  street: ["123 Main St"],
  city: "Townsville",
  postalCode: "00000",
  country: "US",
});

describe("AutofillManager", () => {
  it("returns an empty list when no file exists", () => {
    const am = new AutofillManager(addressesPath());
    expect(am.getAddresses()).toEqual([]);
  });

  it("loads an existing addresses file", () => {
    writeFileSync(addressesPath(), JSON.stringify([sampleAddress("seed-1")]));
    const am = new AutofillManager(addressesPath());
    expect(am.getAddresses()).toHaveLength(1);
    expect(am.getAddresses()[0].id).toBe("seed-1");
  });

  it("saveAddress() assigns a uuid when id is empty", () => {
    const am = new AutofillManager(addressesPath());
    const saved = am.saveAddress(sampleAddress());
    expect(saved.id).toMatch(/[0-9a-f-]{36}/);
    expect(am.getAddresses()).toHaveLength(1);
  });

  it("saveAddress() preserves a caller-provided id and updates in place", () => {
    const am = new AutofillManager(addressesPath());
    am.saveAddress(sampleAddress("fixed-id"));
    am.saveAddress({ ...sampleAddress("fixed-id"), city: "Newtown" });
    const all = am.getAddresses();
    expect(all).toHaveLength(1);
    expect(all[0].city).toBe("Newtown");
  });

  it("removeAddress() drops the entry by id", () => {
    const am = new AutofillManager(addressesPath());
    const a = am.saveAddress(sampleAddress());
    const b = am.saveAddress(sampleAddress());
    am.removeAddress(a.id);
    const ids = am.getAddresses().map((x) => x.id);
    expect(ids).not.toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it("persists across instances", () => {
    const am = new AutofillManager(addressesPath());
    am.saveAddress(sampleAddress("p1"));
    const am2 = new AutofillManager(addressesPath());
    expect(am2.getAddresses().map((a) => a.id)).toContain("p1");
  });

  it("falls back to empty list on corrupted JSON", () => {
    writeFileSync(addressesPath(), "{not json");
    const am = new AutofillManager(addressesPath());
    expect(am.getAddresses()).toEqual([]);
  });
});
