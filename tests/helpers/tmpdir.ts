import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach } from "vitest";

export interface TmpDir {
  path: (name: string) => string;
}

export function useTmpDir(prefix: string): TmpDir {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    path: (name) => join(dir, name),
  };
}
