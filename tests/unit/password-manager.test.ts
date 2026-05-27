import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync } from "fs";
import {
  PasswordManager,
  type PasswordCrypto,
} from "@electron/services/PasswordManager";
import { useTmpDir } from "../helpers/tmpdir";

// Reversible "encryption" — verifies the load/save round-trip without
// depending on Electron's safeStorage. The PasswordManager must never
// read or write the plaintext directly to disk.
const reverseCrypto: PasswordCrypto = {
  encrypt: (s) => Buffer.from(s).reverse().toString("base64"),
  decrypt: (s) =>
    Buffer.from(Buffer.from(s, "base64")).reverse().toString("utf-8"),
};

const tmp = useTmpDir("horizon-passwords");
const passwordsPath = () => tmp.path("passwords.json");

describe("PasswordManager", () => {
  it("returns an empty list when no file exists", () => {
    const pm = new PasswordManager(passwordsPath(), reverseCrypto);
    expect(pm.getAll()).toEqual([]);
  });

  it("encrypts passwords on save and decrypts on load", () => {
    const pm = new PasswordManager(passwordsPath(), reverseCrypto);
    pm.saveEntry({
      origin: "https://example.com",
      username: "alice",
      password: "hunter2",
    });

    // Direct file inspection: plaintext must not appear on disk.
    const raw = readFileSync(passwordsPath(), "utf-8");
    expect(raw).not.toContain("hunter2");

    // A fresh instance over the same path + crypto decrypts back to the original.
    const pm2 = new PasswordManager(passwordsPath(), reverseCrypto);
    const loaded = pm2.getAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].password).toBe("hunter2");
  });

  it("saveEntry() stamps createdAt on first save, lastUsedAt on overwrite", () => {
    const pm = new PasswordManager(passwordsPath(), reverseCrypto);
    pm.saveEntry({
      origin: "https://x.example",
      username: "u",
      password: "p1",
    });
    const first = pm.getAll()[0];
    expect(first.createdAt).toBeTypeOf("number");

    pm.saveEntry({
      origin: "https://x.example",
      username: "u",
      password: "p2",
    });
    const overwritten = pm.getAll()[0];
    expect(overwritten.password).toBe("p2");
    expect(overwritten.lastUsedAt).toBeTypeOf("number");
    expect(pm.getAll()).toHaveLength(1);
  });

  it("saveEntry() treats (origin, username) as the composite key", () => {
    const pm = new PasswordManager(passwordsPath(), reverseCrypto);
    pm.saveEntry({
      origin: "https://x.example",
      username: "alice",
      password: "a",
    });
    pm.saveEntry({
      origin: "https://x.example",
      username: "bob",
      password: "b",
    });
    pm.saveEntry({
      origin: "https://y.example",
      username: "alice",
      password: "c",
    });
    expect(pm.getAll()).toHaveLength(3);
  });

  it("remove() drops the entry matching (origin, username)", () => {
    const pm = new PasswordManager(passwordsPath(), reverseCrypto);
    pm.saveEntry({
      origin: "https://x.example",
      username: "alice",
      password: "a",
    });
    pm.saveEntry({
      origin: "https://x.example",
      username: "bob",
      password: "b",
    });
    pm.remove("https://x.example", "alice");
    const remaining = pm.getAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].username).toBe("bob");
  });

  it("getForOrigin() returns only entries for that origin", () => {
    const pm = new PasswordManager(passwordsPath(), reverseCrypto);
    pm.saveEntry({
      origin: "https://x.example",
      username: "alice",
      password: "a",
    });
    pm.saveEntry({
      origin: "https://y.example",
      username: "alice",
      password: "b",
    });
    expect(pm.getForOrigin("https://x.example")).toHaveLength(1);
    expect(pm.getForOrigin("https://x.example")[0].password).toBe("a");
  });

  it("corrupted file falls back to empty list", () => {
    writeFileSync(passwordsPath(), "{not json");
    const pm = new PasswordManager(passwordsPath(), reverseCrypto);
    expect(pm.getAll()).toEqual([]);
  });
});
