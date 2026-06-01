#!/usr/bin/env node
/**
 * Pack the Pi coding agent into a single self-contained binary with Bun,
 * dropping it (plus the runtime assets it loads relative to the
 * executable) into `resources/bin/`. electron-builder ships that folder
 * as an extraResource, and the app spawns it instead of requiring users
 * to install `pi` globally.
 *
 * Usage:
 *   node scripts/build-pi.mjs                # build for the host platform
 *   node scripts/build-pi.mjs --target=bun-linux-x64
 *   node scripts/build-pi.mjs --target=bun-windows-x64
 *
 * Requires Bun on PATH (https://bun.sh). The pi binary is intentionally
 * git-ignored — it is produced at package time, not committed.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "resources", "bin");

const targetArg = process.argv.find((a) => a.startsWith("--target="));
const target = targetArg ? targetArg.slice("--target=".length) : "";
const isWindows = target ? target.includes("windows") : process.platform === "win32";
const binName = isWindows ? "pi.exe" : "pi";

function fail(msg) {
  console.error(`[build-pi] ${msg}`);
  process.exit(1);
}

// Locate the installed pi package root. Its package.json isn't exposed
// via the "exports" map (and there's no CJS condition), so resolve from
// node_modules directly, then fall back to import.meta.resolve.
const PKG = "@earendil-works/pi-coding-agent";
let pkgDir = path.join(repoRoot, "node_modules", ...PKG.split("/"));
if (!existsSync(path.join(pkgDir, "package.json"))) {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.resolve(PKG)));
    while (
      dir !== path.dirname(dir) &&
      !existsSync(path.join(dir, "package.json"))
    ) {
      dir = path.dirname(dir);
    }
    pkgDir = dir;
  } catch {
    /* handled below */
  }
}
if (!existsSync(path.join(pkgDir, "package.json"))) {
  fail(`Cannot find ${PKG}. Run \`npm install\` first.`);
}
const distDir = path.join(pkgDir, "dist");

// Verify Bun is available.
if (spawnSync("bun", ["--version"], { stdio: "ignore" }).status !== 0) {
  fail("Bun is required to compile pi. Install it from https://bun.sh");
}

// Fresh output dir.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Compile. Mirrors the package's own `build:binary` entry points: the
// Bun CLI shim plus the image-resize worker (spawned as a separate file).
const cliEntry = path.join(distDir, "bun", "cli.js");
const workerEntry = path.join(distDir, "utils", "image-resize-worker.js");
const outFile = path.join(outDir, binName);
const buildArgs = ["build", "--compile"];
if (target) buildArgs.push(`--target=${target}`);
buildArgs.push(cliEntry, workerEntry, "--outfile", outFile);

console.log(`[build-pi] compiling pi → ${path.relative(repoRoot, outFile)}`);
const build = spawnSync("bun", buildArgs, { stdio: "inherit" });
if (build.status !== 0) fail("bun build failed");

// Copy the assets pi loads relative to the executable (see config.ts:
// getPackageDir → dirname(process.execPath) for Bun binaries).
function copyInto(srcDir, destSubdir, filter) {
  if (!existsSync(srcDir)) return;
  const dest = path.join(outDir, destSubdir);
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    if (filter && !filter(name)) continue;
    copyFileSync(path.join(srcDir, name), path.join(dest, name));
  }
}

// package.json is read at module init; README/CHANGELOG by help tools.
for (const f of ["package.json", "README.md", "CHANGELOG.md"]) {
  const src = path.join(pkgDir, f);
  if (existsSync(src)) copyFileSync(src, path.join(outDir, f));
}
copyInto(path.join(distDir, "modes", "interactive", "theme"), "theme", (n) =>
  n.endsWith(".json"),
);
copyInto(path.join(distDir, "modes", "interactive", "assets"), "assets", (n) =>
  n.endsWith(".png"),
);
copyInto(path.join(distDir, "core", "export-html"), "export-html", (n) =>
  n.endsWith(".html") || n.endsWith(".css") || n.endsWith(".js"),
);
copyInto(
  path.join(distDir, "core", "export-html", "vendor"),
  path.join("export-html", "vendor"),
  (n) => n.endsWith(".js"),
);
for (const dir of ["docs", "examples"]) {
  const src = path.join(pkgDir, dir);
  if (existsSync(src)) cpSync(src, path.join(outDir, dir), { recursive: true });
}
// photon WASM (image tooling) — copy from pi's dependency tree. May be
// nested under pi's own node_modules or hoisted to the repo root.
const wasmRel = path.join(
  "node_modules",
  "@silvia-odwyer",
  "photon-node",
  "photon_rs_bg.wasm",
);
const wasmSrc = [
  path.join(pkgDir, wasmRel),
  path.join(repoRoot, wasmRel),
].find((p) => existsSync(p));
if (wasmSrc) {
  copyFileSync(wasmSrc, path.join(outDir, "photon_rs_bg.wasm"));
} else {
  console.warn(
    "[build-pi] photon_rs_bg.wasm not found — image tools may be limited",
  );
}

console.log(`[build-pi] done → ${path.relative(repoRoot, outDir)}/${binName}`);
