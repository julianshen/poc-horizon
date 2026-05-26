import React, { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';

interface Props { text: string }

/**
 * Code-fence renderer with an always-visible Copy button in the top-right
 * corner. Same affordance Claude.ai / ChatGPT use — single click puts the
 * snippet on the clipboard. Shows a checkmark for ~1s after a successful
 * copy; silently fails on permission denial.
 */
const CopyableCodeBlock: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => {
  const [copied, setCopied] = useState(false);
  // react-markdown delivers code-block contents as a string (or a single
  // text-node array). Flatten to a string for the clipboard.
  const code = React.Children.toArray(children).map((c) => typeof c === 'string' ? c : '').join('');
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* permission denied — silent */ }
  }, [code]);

  return (
    <div style={{ position: 'relative', margin: '0.5em 0' }}>
      <pre style={{
        background: 'var(--surface-2)',
        borderRadius: 8,
        padding: '10px 12px',
        margin: 0,
        fontSize: '12px',
        lineHeight: 1.5,
        fontFamily: 'var(--font-mono)',
        overflow: 'auto',
      }}>
        <code className={className}>{children}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy code'}
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          background: 'var(--surface-1)',
          color: copied ? 'var(--success)' : 'var(--chrome-fg-muted)',
          border: '0.5px solid var(--chrome-border)',
          borderRadius: 6,
          width: 24,
          height: 24,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {copied ? (
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </div>
  );
};

/**
 * Markdown renderer for AI chat output. Wraps react-markdown with the
 * Dia chat aesthetic — inline code in surface-2 pills, code blocks in
 * surface-2 boxes with mono font, links that open externally via the
 * standard <a> with target=_blank.
 *
 * Note: react-markdown escapes HTML by default, so no XSS surface from
 * Pi's output even if the model emits raw tags.
 */
export const ChatMarkdown: React.FC<Props> = ({ text }) => (
  <ReactMarkdown
    components={{
      // Tight paragraphs — chat bubbles look bad with default p { margin: 1em }.
      p: ({ children }) => <p style={{ margin: '0 0 0.5em' }}>{children}</p>,
      // Inline code: subtle pill, monospace. Block code: wrapped in a
      // CopyableCodeBlock that adds a top-right copy button.
      pre: ({ children }) => <>{children}</>,
      code: ({ className, children, ...rest }) => {
        const isBlock = /language-/.test(className ?? '');
        if (isBlock) {
          return <CopyableCodeBlock className={className}>{children}</CopyableCodeBlock>;
        }
        return (
          <code
            style={{
              background: 'var(--surface-2)',
              borderRadius: 4,
              padding: '1px 5px',
              fontSize: '0.92em',
              fontFamily: 'var(--font-mono)',
            }}
            {...rest}
          >
            {children}
          </code>
        );
      },
      // Links: external, with the rose accent and underline on hover.
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: 'var(--accent-primary)', textDecoration: 'underline', textUnderlineOffset: 2 }}
        >
          {children}
        </a>
      ),
      // Lists: tighter spacing than default browser.
      ul: ({ children }) => <ul style={{ margin: '0.25em 0 0.5em', paddingLeft: '1.25em' }}>{children}</ul>,
      ol: ({ children }) => <ol style={{ margin: '0.25em 0 0.5em', paddingLeft: '1.25em' }}>{children}</ol>,
      li: ({ children }) => <li style={{ margin: '0.1em 0' }}>{children}</li>,
      // Headings: minimal — chat doesn't need huge h1s.
      h1: ({ children }) => <h1 style={{ fontSize: '1.05em', fontWeight: 600, margin: '0.4em 0 0.2em' }}>{children}</h1>,
      h2: ({ children }) => <h2 style={{ fontSize: '1em', fontWeight: 600, margin: '0.4em 0 0.2em' }}>{children}</h2>,
      h3: ({ children }) => <h3 style={{ fontSize: '0.95em', fontWeight: 600, margin: '0.4em 0 0.2em' }}>{children}</h3>,
      // Blockquote: left rule using the accent-soft tint.
      blockquote: ({ children }) => (
        <blockquote style={{
          borderLeft: '2px solid var(--chrome-border-strong)',
          margin: '0.5em 0',
          padding: '0 0 0 10px',
          color: 'var(--chrome-fg-muted)',
        }}>{children}</blockquote>
      ),
      hr: () => <hr style={{ border: 0, borderTop: '0.5px solid var(--chrome-border)', margin: '0.6em 0' }} />,
    }}
  >
    {text}
  </ReactMarkdown>
);
