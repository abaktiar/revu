import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlightLine } from '../highlight';

interface Props {
  source: string;
  className?: string;
}

const components: Components = {
  // Open every link in the system browser. The BrowserWindow's
  // setWindowOpenHandler in main.ts routes target=_blank requests to
  // shell.openExternal, so we don't need a separate IPC bridge.
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  // react-markdown v9 dropped the `inline` flag on the code component. The
  // standard markdown output structure is `<pre><code>…</code></pre>` for
  // fenced blocks and bare `<code>…</code>` for inline code, so we override
  // `pre` to apply our wrapper class and `code` to do syntax highlighting
  // only when a language class is present.
  pre({ children }) {
    return <pre className="md-codeblock">{children}</pre>;
  },
  code({ className, children }) {
    const text = Array.isArray(children)
      ? children.join('')
      : String(children ?? '');
    const m = /language-([\w+-]+)/.exec(className ?? '');
    if (!m) {
      return <code className={className}>{text}</code>;
    }
    const lang = m[1] ?? null;
    const html = highlightLine(text.replace(/\n$/, ''), lang);
    return (
      <code
        className={`hljs${lang ? ` language-${lang}` : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  },
};

export function Markdown({ source, className }: Props): JSX.Element {
  return (
    <div className={`md-body${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
