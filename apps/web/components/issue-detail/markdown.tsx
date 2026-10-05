import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * Renders issue and comment markdown. Raw HTML is never rendered (react-markdown ignores it
 * without rehype-raw) and the result goes through rehype-sanitize as well, so `<script>`,
 * event handlers and `javascript:` URLs are dropped even if a plugin is added later.
 * Agents write much of this text, so treat it as untrusted.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{ a: ExternalLink }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function ExternalLink({ node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  return <a {...props} target="_blank" rel="noopener noreferrer nofollow" />;
}
