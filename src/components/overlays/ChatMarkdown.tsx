import React from 'react';
import ReactMarkdown from 'react-markdown';

interface Props { text: string }

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
      // Inline code: subtle pill, monospace.
      code: ({ className, children, ...rest }) => {
        const isBlock = /language-/.test(className ?? '');
        if (isBlock) {
          return (
            <pre style={{
              background: 'var(--surface-2)',
              borderRadius: 8,
              padding: '10px 12px',
              margin: '0.5em 0',
              fontSize: '12px',
              lineHeight: 1.5,
              fontFamily: 'var(--font-mono)',
              overflow: 'auto',
            }}>
              <code className={className} {...rest}>{children}</code>
            </pre>
          );
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
