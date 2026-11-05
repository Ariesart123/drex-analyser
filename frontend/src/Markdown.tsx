import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

export interface MdBase { fullName: string; branch: string }

// Raw HTML is never parsed (no rehype-raw), output goes through rehype-sanitize, and URLs are allow-listed.
export function safeUrl(url: string, key: string, base?: MdBase): string {
  if (/^(https?:|mailto:|#)/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//') || !base) return '';
  const root = key === 'src' ? `https://raw.githubusercontent.com/${base.fullName}/${base.branch}/` : `https://github.com/${base.fullName}/blob/${base.branch}/`;
  try { return new URL(url.replace(/^\.?\//, ''), root).toString(); } catch { return ''; }
}

export default function Markdown({ children, base }: { children: string; base?: MdBase }) {
  return (
    <div className="md text-sm leading-relaxed break-words space-y-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-sec [&_pre]:p-3 [&_code]:text-accent [&_table]:block [&_table]:overflow-x-auto [&_a]:text-primary [&_a]:underline [&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_img]:max-w-full">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} urlTransform={(u, k) => safeUrl(u, k, base)}
        components={{
          a: ({ href, children: c }) => <a href={href || undefined} target="_blank" rel="noopener noreferrer nofollow">{c}</a>,
          img: ({ src, alt }) => (src ? <img src={src} alt={alt ?? ''} loading="lazy" referrerPolicy="no-referrer" /> : null),
        }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
