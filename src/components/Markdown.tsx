import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Renders assistant messages as GitHub-flavored Markdown, the way ChatGPT/Grok
// do — headings, bold, lists, tables, code. Links open safely in a new tab.
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
