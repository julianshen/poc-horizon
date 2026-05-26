import { spawn } from 'child_process';

interface TranslateOptions {
  /** Pi binary path (default: 'pi'). */
  binary?: string;
  /** Hard timeout in ms (default: 60_000). */
  timeoutMs?: number;
  /** Abort signal to cancel translation. */
  signal?: AbortSignal;
}

/**
 * Translate text via a headless `pi -p` invocation. Each call spawns
 * a fresh Pi process with --no-session --no-tools so the chat
 * conversation history is not polluted and no browser tools fire.
 *
 * Pi's -p mode prints the agent's final answer to stdout and exits.
 * We collect stdout, strip surrounding whitespace, and return.
 *
 * Returns null on timeout / spawn failure / empty output — callers
 * decide whether to surface the error or leave the source text in place.
 */
export async function translateText(
  text: string,
  targetLang: string,
  opts: TranslateOptions = {}
): Promise<string | null> {
  if (!text || !text.trim()) return null;
  const binary = opts.binary ?? 'pi';
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const prompt =
    `Translate the following text to ${targetLang}. ` +
    `Output ONLY the translation — no preamble, no explanations, no quotes around the result. ` +
    `Preserve the original line breaks and basic structure. ` +
    `If the text is already in ${targetLang}, return it unchanged.\n\n` +
    text;

  return new Promise<string | null>((resolve) => {
    if (opts.signal?.aborted) {
      resolve(null);
      return;
    }

    const proc = spawn(binary, ['-p', '--no-session', '--no-tools', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let killed = false;

    const onAbort = () => {
      killed = true;
      proc.kill();
      resolve(null);
    };

    if (opts.signal) {
      opts.signal.addEventListener('abort', onAbort);
    }

    const timer = setTimeout(() => { killed = true; proc.kill(); }, timeoutMs);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (c: string) => { out += c; });
    proc.on('error', () => {
      clearTimeout(timer);
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort);
      }
      resolve(null);
    });
    proc.on('exit', () => {
      clearTimeout(timer);
      if (opts.signal) {
        opts.signal.removeEventListener('abort', onAbort);
      }
      if (killed) { resolve(null); return; }
      const trimmed = out.trim();
      resolve(trimmed.length > 0 ? trimmed : null);
    });
  });
}

/**
 * Translate an array of text fragments in a single Pi call. The LLM
 * sees a delimited list, returns the same list translated; we split
 * on the delimiter. Faster than N individual spawns for full-page
 * translation but limited by Pi's context budget — caller batches.
 */
export async function translateBatch(
  fragments: string[],
  targetLang: string,
  opts: TranslateOptions = {}
): Promise<(string | null)[]> {
  if (fragments.length === 0) return [];
  const DELIM = '\n‡§HZ§‡\n';
  const text = fragments.join(DELIM);
  const result = await translateText(text, targetLang, opts);
  if (result === null) return fragments.map(() => null);
  const parts = result.split(DELIM);
  // If the LLM didn't preserve the delimiter (drift) we conservatively
  // return nulls so the page falls back to the originals rather than
  // garbling adjacent fragments.
  if (parts.length !== fragments.length) return fragments.map(() => null);
  return parts.map((p) => p.trim());
}
