import React from "react";
import { Streamdown } from "streamdown";

interface Props {
  text: string;
  /** True while the model is actively streaming this message. Streamdown
   *  uses it to render an animated caret + tolerate partial markdown
   *  (unclosed fences, dangling bold markers, etc). */
  isAnimating?: boolean;
}

/**
 * Markdown renderer for AI chat output. Backed by Streamdown
 * (https://streamdown.ai), which is purpose-built for AI streaming —
 * partial-markdown tolerance, Shiki syntax highlighting with built-in
 * copy/download buttons per code block, table copy menus, and link
 * safety. We pass through Dia-themed React component overrides so the
 * inline elements match the rest of the AI panel.
 */
export const ChatMarkdown: React.FC<Props> = ({
  text,
  isAnimating = false,
}) => (
  <Streamdown
    isAnimating={isAnimating}
    parseIncompleteMarkdown
    shikiTheme={["github-light", "github-dark"]}
    components={{
      p: ({ children }) => <p style={{ margin: "0 0 0.5em" }}>{children}</p>,
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          style={{
            color: "var(--accent-primary)",
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          {children}
        </a>
      ),
      ul: ({ children }) => (
        <ul style={{ margin: "0.25em 0 0.5em", paddingLeft: "1.25em" }}>
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol style={{ margin: "0.25em 0 0.5em", paddingLeft: "1.25em" }}>
          {children}
        </ol>
      ),
      li: ({ children }) => <li style={{ margin: "0.1em 0" }}>{children}</li>,
      h1: ({ children }) => (
        <h1
          style={{
            fontSize: "1.05em",
            fontWeight: 600,
            margin: "0.4em 0 0.2em",
          }}
        >
          {children}
        </h1>
      ),
      h2: ({ children }) => (
        <h2
          style={{ fontSize: "1em", fontWeight: 600, margin: "0.4em 0 0.2em" }}
        >
          {children}
        </h2>
      ),
      h3: ({ children }) => (
        <h3
          style={{
            fontSize: "0.95em",
            fontWeight: 600,
            margin: "0.4em 0 0.2em",
          }}
        >
          {children}
        </h3>
      ),
      blockquote: ({ children }) => (
        <blockquote
          style={{
            borderLeft: "2px solid var(--chrome-border-strong)",
            margin: "0.5em 0",
            padding: "0 0 0 10px",
            color: "var(--chrome-fg-muted)",
          }}
        >
          {children}
        </blockquote>
      ),
      hr: () => (
        <hr
          style={{
            border: 0,
            borderTop: "0.5px solid var(--chrome-border)",
            margin: "0.6em 0",
          }}
        />
      ),
    }}
  >
    {text}
  </Streamdown>
);
