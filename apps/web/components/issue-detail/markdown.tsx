import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { attachmentIdFromUrl, fileUrl } from "@/lib/attachments";

type HastNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

/**
 * Agent-written text must not make the viewer's browser fetch arbitrary URLs, so the only images
 * rendered are Traccia attachments: `<BASE_URL>/files/<id>` (what `create_attachment` produces) is
 * rewritten to the proxy route and every other image is dropped. Runs BEFORE rehype-sanitize, which
 * then also refuses any `src` that has a protocol (a second layer if this plugin were bypassed).
 */
function rehypeAttachmentImages() {
  const walk = (node: HastNode) => {
    if (!node.children) return;
    node.children = node.children.filter((child) => {
      if (child.type === "element" && child.tagName === "img") {
        const id = attachmentIdFromUrl(String(child.properties?.src ?? ""));
        if (!id) return false;
        child.properties = { ...child.properties, src: fileUrl(id), loading: "lazy" };
        return true;
      }
      walk(child);
      return true;
    });
  };
  return (tree: HastNode) => walk(tree);
}

const schema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, img: ["src", "alt", "title", "loading"] },
  protocols: { ...defaultSchema.protocols, src: [] },
};

/**
 * Renders issue and comment markdown. Raw HTML is never rendered (react-markdown ignores it
 * without rehype-raw) and the result goes through rehype-sanitize as well, so `<script>`,
 * event handlers and `javascript:` URLs are dropped even if a plugin is added later.
 * Agents write much of this text, so treat it as untrusted.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeAttachmentImages, [rehypeSanitize, schema]]} components={{ a: ExternalLink }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

function ExternalLink({ node: _node, ...props }: ComponentProps<"a"> & { node?: unknown }) {
  return <a {...props} target="_blank" rel="noopener noreferrer nofollow" />;
}
