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

- [x] Fix: `appMenu.ts` — remove hardcoded 'English', send `menu:command` instead
- [x] Fix: `TabManager.ts` — read `translateTargetLang` from settings, fix error handling
- [x] Fix: `useMenuCommands.ts` — add `translate:open` and `translate:restore` cases
- [x] Fix: misleading comment in `TabManager.ts` line 262

## Phase 3: TranslationBar UI component

- [x] Add `showTranslationBar` + `translationProgress` to `browserStore.ts`
- [x] Create `TranslationBar.tsx` component with language picker, progress, restore
- [x] Wire `TranslationBar` into parent layout
- [x] Add unit tests for `TranslationBar.tsx`

## Phase 4: Cancellation support

- [x] Add `AbortSignal` to `pageTranslator.ts` `translatePage()`
- [x] Add `AbortSignal` to `LlmTranslator.ts` `translateText()`
- [x] Add `TRANSLATE_CANCEL` IPC channel + handler in `main.ts`
- [x] Add cancel button to `TranslationBar.tsx`
- [x] Add unit tests for cancellation

## Phase 5: Fix infinite 'Thinking...' state on LLM or prompt command errors

- [x] Test: `response` with `success: false` sets `this.running = false` and emits `turn_end`
- [x] Test: `agent_end` with `errorMessage` or `stopReason: 'error'` in assistant message emits `error` event and clears `this.running`
- [x] Test: `turn_end` with `errorMessage` or `stopReason: 'error'` in assistant message emits `error` event and clears `this.running`
- [x] Test: consecutive `turn_end` and `agent_end` does not emit duplicate error events
- [x] Fix: `PiSession.ts` command `response` failure handling
- [x] Fix: `PiSession.ts` `agent_end` and `turn_end` error handling
