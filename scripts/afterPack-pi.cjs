// electron-builder afterPack hook: rebuild the bundled Pi binary for the
// *specific* platform/arch being packed, overwriting the host-arch copy
// that extraResources placed in the app. Without this, a multi-arch build
// (e.g. `dist:mac` → x64 + arm64) would ship the same host binary in both
// artifacts and the agent would fail to spawn on the mismatched arch.
//
// CommonJS (.cjs) so electron-builder can `require()` it regardless of the
// package's module type.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

// builder-util Arch enum values → bun --target arch suffix.
const ARCH_IA32 = 0;
const ARCH_X64 = 1;
const ARCH_ARMV7L = 2;
const ARCH_ARM64 = 3;
const ARCH_UNIVERSAL = 4;
const ARCH = {
  [ARCH_IA32]: "ia32",
  [ARCH_X64]: "x64",
  [ARCH_ARMV7L]: "armv7l",
  [ARCH_ARM64]: "arm64",
  [ARCH_UNIVERSAL]: "universal",
};
const BUN_OS = { darwin: "darwin", win32: "windows", linux: "linux" };

module.exports = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch, packager } = context;
  const archName = ARCH[arch] ?? String(arch);
  const bunOs = BUN_OS[electronPlatformName];

  if (!bunOs) {
    console.warn(`[afterPack-pi] unknown platform ${electronPlatformName}; skipping`);
    return;
  }
  if (archName === "universal") {
    // Bun can't emit a universal binary directly (would need lipo of two
    // builds). The current config packs x64/arm64 separately, so this
    // shouldn't be hit; warn rather than ship a wrong-arch binary.
    console.warn("[afterPack-pi] universal arch unsupported by bun --compile; skipping");
    return;
  }
  const bunTarget = `bun-${bunOs}-${archName}`;

  // Resources dir inside the packed app.
  const resourcesDir =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, "Contents", "Resources")
      : path.join(appOutDir, "resources");
  const outDir = path.join(resourcesDir, "bin");

  const script = path.join(__dirname, "build-pi.mjs");
  console.log(`[afterPack-pi] building ${bunTarget} → ${outDir}`);
  const res = spawnSync(
    process.execPath,
    [script, `--target=${bunTarget}`, `--out=${outDir}`],
    { stdio: "inherit" },
  );
  if (res.status !== 0) {
    throw new Error(`[afterPack-pi] build-pi failed for ${bunTarget}`);
  }
};
