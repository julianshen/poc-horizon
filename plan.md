# Horizon Browser Translation Improvements — Implementation Plan

## Phase 1: Unit tests for `pageTranslator.ts`
- [x] Test: `translatePage` calls `executeJavaScript` with extract script and returns nodes
- [x] Test: `translatePage` batches nodes by character count (4000 char cap)
- [x] Test: `translatePage` calls `translateBatch` for each batch and applies via apply script
- [x] Test: `translatePage` fires `onProgress` callback after each batch
- [x] Test: `translatePage` returns `{ ok: false }` when extraction yields no nodes
- [x] Test: `translatePage` returns `{ ok: false }` when `executeJavaScript` throws on extraction
- [x] Test: `translatePage` breaks loop when `executeJavaScript` throws during apply (tab closed)
- [x] Test: `translatePage` handles `translateBatch` returning all nulls
- [x] Test: `translatePage` handles single node exceeding `BATCH_CHAR_CAP`
- [x] Test: `restorePage` calls `executeJavaScript` with restore script
- [x] Test: `restorePage` returns `{ restored: 0 }` when `executeJavaScript` throws

## Phase 2: Fix hardcoded language & read settings
- [ ] Fix: `appMenu.ts` — remove hardcoded 'English', send `menu:command` instead
- [ ] Fix: `TabManager.ts` — read `translateTargetLang` from settings, fix error handling
- [ ] Fix: `useMenuCommands.ts` — add `translate:open` and `translate:restore` cases
- [ ] Fix: misleading comment in `TabManager.ts` line 262

## Phase 3: TranslationBar UI component
- [ ] Add `showTranslationBar` + `translationProgress` to `browserStore.ts`
- [ ] Create `TranslationBar.tsx` component with language picker, progress, restore
- [ ] Wire `TranslationBar` into parent layout
- [ ] Add unit tests for `TranslationBar.tsx`

## Phase 4: Cancellation support
- [ ] Add `AbortSignal` to `pageTranslator.ts` `translatePage()`
- [ ] Add `AbortSignal` to `LlmTranslator.ts` `translateText()`
- [ ] Add `TRANSLATE_CANCEL` IPC channel + handler in `main.ts`
- [ ] Add cancel button to `TranslationBar.tsx`
- [ ] Add unit tests for cancellation
