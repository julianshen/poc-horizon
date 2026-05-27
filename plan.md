# Horizon Browser — Active Plan

Refer to `plan.archived.md` for completed phases.

## Phase 7: Reduce image sizes sent to LLM

- [x] Test: `screenshot` supports `scale` option and uses CDP `clip` with scale
- [x] Test: `screenshotMarked` supports `scale` option and uses CDP `clip` with scale
- [x] Test: `screenshot` defaults to `"jpeg"` format with a default `quality`
- [ ] Test: `HorizonBridgeServer` routes `scale` parameter for both screenshot tools
- [ ] Fix: Update `BrowserHarness.ts` to implement downscaling via CDP `clip.scale`
- [ ] Fix: Update `HorizonBridgeServer.ts` to accept `scale` and set a default scale (e.g. `0.5`)
