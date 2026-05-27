# Horizon Browser — Active Plan

Refer to `plan.archived.md` for completed phases.

## Phase 7: Reduce image sizes sent to LLM

- [x] Test: `screenshot` supports `scale` option and uses CDP `clip` with scale
- [x] Test: `screenshotMarked` supports `scale` option and uses CDP `clip` with scale
- [x] Test: `screenshot` defaults to `"jpeg"` format with a default `quality`
- [x] Test: `HorizonBridgeServer` routes `scale` parameter for both screenshot tools
- [x] Fix: Update `BrowserHarness.ts` to implement downscaling via CDP `clip.scale`
- [x] Fix: Update `HorizonBridgeServer.ts` to accept `scale` and set a default scale (e.g. `0.5`)

## Phase 8: Prevent token limit overflow from large llms.txt and llms-full.txt

- [x] Test: `writePiSkill` truncates `llmsTxt` and `llmsFullTxt` to safe character limits
- [ ] Test: Prompt augmentation under `AI_START` truncates `site-skills` to safe character limits
- [ ] Fix: Update `piSkillWriter.ts` to truncate inputs
- [ ] Fix: Update `.electron/main.ts` `AI_START` to truncate prompt-injected site skills
