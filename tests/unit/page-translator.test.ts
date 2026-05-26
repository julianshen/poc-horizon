// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { translatePage, restorePage } from '@electron/services/pageTranslator';
import { translateBatch } from '@electron/services/LlmTranslator';
import type { WebContents } from 'electron';

vi.mock('@electron/services/LlmTranslator', () => ({
  translateBatch: vi.fn(),
}));

describe('pageTranslator', () => {
  let mockWebContents: Partial<WebContents>;
  let executeJavaScriptMock: import('vitest').Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    executeJavaScriptMock = vi.fn();
    mockWebContents = {
      executeJavaScript: executeJavaScriptMock,
    } as unknown as WebContents;
  });

  describe('translatePage', () => {
    it('calls executeJavaScript with extract script and returns nodes successfully', async () => {
      executeJavaScriptMock.mockResolvedValueOnce([
        { id: 1, text: 'Hello' },
        { id: 2, text: 'World' },
      ]);
      vi.mocked(translateBatch).mockResolvedValueOnce(['Hola', 'Mundo']);
      executeJavaScriptMock.mockResolvedValueOnce({ applied: 2 });

      const onProgress = vi.fn();
      const res = await translatePage(mockWebContents as WebContents, 'Spanish', onProgress);

      expect(executeJavaScriptMock).toHaveBeenNthCalledWith(1, expect.stringContaining('__horizonTranslate'), true);
      expect(translateBatch).toHaveBeenCalledWith(['Hello', 'World'], 'Spanish');
      expect(executeJavaScriptMock).toHaveBeenNthCalledWith(2, expect.stringContaining('applied'), true);
      expect(onProgress).toHaveBeenCalledWith(2, 2);
      expect(res).toEqual({ ok: true, translated: 2, total: 2 });
    });

    it('batches nodes by character count (4000 char cap)', async () => {
      // 3 nodes: first is 2500 chars, second is 2000 chars, third is 1000 chars
      // Batch 1: node 1 (2500 chars). Node 2 (2000 chars) would exceed 4000, so it goes to Batch 2.
      // Batch 2: node 2 (2000 chars). Node 3 (1000 chars) fits in Batch 2 (total 3000 chars).
      const text1 = 'a'.repeat(2500);
      const text2 = 'b'.repeat(2000);
      const text3 = 'c'.repeat(1000);

      executeJavaScriptMock.mockResolvedValueOnce([
        { id: 1, text: text1 },
        { id: 2, text: text2 },
        { id: 3, text: text3 },
      ]);

      vi.mocked(translateBatch)
        .mockResolvedValueOnce(['translated1'])
        .mockResolvedValueOnce(['translated2', 'translated3']);

      executeJavaScriptMock
        .mockResolvedValueOnce({ applied: 1 })
        .mockResolvedValueOnce({ applied: 2 });

      const onProgress = vi.fn();
      const res = await translatePage(mockWebContents as WebContents, 'Spanish', onProgress);

      expect(translateBatch).toHaveBeenCalledTimes(2);
      expect(translateBatch).toHaveBeenNthCalledWith(1, [text1], 'Spanish');
      expect(translateBatch).toHaveBeenNthCalledWith(2, [text2, text3], 'Spanish');

      expect(executeJavaScriptMock).toHaveBeenCalledTimes(3); // Extract + Apply 1 + Apply 2
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3);
      expect(onProgress).toHaveBeenNthCalledWith(2, 3, 3);
      expect(res).toEqual({ ok: true, translated: 3, total: 3 });
    });

    it('fires onProgress callback after each batch', async () => {
      executeJavaScriptMock.mockResolvedValueOnce([
        { id: 1, text: 'One' },
        { id: 2, text: 'Two' },
      ]);
      // Run with two separate batches by making character count larger than 4000
      // Actually, wait, let's just make the text larger to force two batches
      const t1 = 'a'.repeat(3000);
      const t2 = 'b'.repeat(2000);
      executeJavaScriptMock.mockReset();
      executeJavaScriptMock.mockResolvedValueOnce([
        { id: 1, text: t1 },
        { id: 2, text: t2 },
      ]);
      vi.mocked(translateBatch)
        .mockResolvedValueOnce(['trans1'])
        .mockResolvedValueOnce(['trans2']);
      executeJavaScriptMock
        .mockResolvedValueOnce({ applied: 1 })
        .mockResolvedValueOnce({ applied: 1 });

      const onProgress = vi.fn();
      await translatePage(mockWebContents as WebContents, 'Spanish', onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
      expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
    });

    it('returns { ok: false } when extraction yields no nodes', async () => {
      executeJavaScriptMock.mockResolvedValueOnce([]);

      const res = await translatePage(mockWebContents as WebContents, 'Spanish');
      expect(res).toEqual({ ok: false, error: 'no translatable text found' });
      expect(translateBatch).not.toHaveBeenCalled();
    });

    it('returns { ok: false } when executeJavaScript throws on extraction', async () => {
      executeJavaScriptMock.mockRejectedValueOnce(new Error('Browser crashed'));

      const res = await translatePage(mockWebContents as WebContents, 'Spanish');
      expect(res).toEqual({ ok: false, error: 'extract failed: Browser crashed' });
      expect(translateBatch).not.toHaveBeenCalled();
    });

    it('breaks loop when executeJavaScript throws during apply (tab closed)', async () => {
      executeJavaScriptMock.mockResolvedValueOnce([
        { id: 1, text: 'One' },
        { id: 2, text: 'Two' },
      ]);
      // Force two batches
      const t1 = 'a'.repeat(3000);
      const t2 = 'b'.repeat(2000);
      executeJavaScriptMock.mockReset();
      executeJavaScriptMock.mockResolvedValueOnce([
        { id: 1, text: t1 },
        { id: 2, text: t2 },
      ]);

      vi.mocked(translateBatch)
        .mockResolvedValueOnce(['trans1'])
        .mockResolvedValueOnce(['trans2']);

      // First apply succeeds, second throws (e.g. tab closed)
      executeJavaScriptMock
        .mockResolvedValueOnce({ applied: 1 })
        .mockRejectedValueOnce(new Error('WebContents destroyed'));

      const onProgress = vi.fn();
      const res = await translatePage(mockWebContents as WebContents, 'Spanish', onProgress);

      // Should break after the first one throws or when it throws
      expect(translateBatch).toHaveBeenCalledTimes(2); // Wait, if the loop does translateBatch for next batch before applying the previous or after?
      // In code:
      // for (const batch of batches) {
      //   const translated = await translateBatch(...)
      //   ...
      //   try {
      //     const r = await wc.executeJavaScript(APPLY_SCRIPT(out))
      //   } catch { break; }
      //   onProgress(...)
      // }
      // So yes, it translates batch 1, tries to apply, succeeds.
      // Then it translates batch 2, tries to apply, throws, catches, breaks!
      // So translateBatch is called twice.
      expect(onProgress).toHaveBeenCalledTimes(1); // Only first batch progress fires because of the try-catch block placement
      expect(res).toEqual({ ok: true, translated: 1, total: 2 });
    });

    it('handles translateBatch returning all nulls', async () => {
      executeJavaScriptMock.mockResolvedValueOnce([
        { id: 1, text: 'Hello' },
      ]);
      vi.mocked(translateBatch).mockResolvedValueOnce([null]);

      const res = await translatePage(mockWebContents as WebContents, 'Spanish');

      expect(executeJavaScriptMock).toHaveBeenCalledTimes(1); // Only extraction, no apply
      expect(res).toEqual({ ok: true, translated: 0, total: 1 });
    });

    it('handles single node exceeding BATCH_CHAR_CAP', async () => {
      const hugeText = 'a'.repeat(5000);
      executeJavaScriptMock.mockResolvedValueOnce([
        { id: 1, text: hugeText },
      ]);
      vi.mocked(translateBatch).mockResolvedValueOnce(['translated_huge']);
      executeJavaScriptMock.mockResolvedValueOnce({ applied: 1 });

      const res = await translatePage(mockWebContents as WebContents, 'Spanish');

      expect(translateBatch).toHaveBeenCalledWith([hugeText], 'Spanish');
      expect(res).toEqual({ ok: true, translated: 1, total: 1 });
    });
  });

  describe('restorePage', () => {
    it('calls executeJavaScript with restore script successfully', async () => {
      executeJavaScriptMock.mockResolvedValueOnce({ restored: 5 });

      const res = await restorePage(mockWebContents as WebContents);

      expect(executeJavaScriptMock).toHaveBeenCalledWith(expect.stringContaining('restored'), true);
      expect(res).toEqual({ restored: 5 });
    });

    it('returns { restored: 0 } when executeJavaScript throws', async () => {
      executeJavaScriptMock.mockRejectedValueOnce(new Error('Tab closed'));

      const res = await restorePage(mockWebContents as WebContents);

      expect(res).toEqual({ restored: 0 });
    });
  });
});
