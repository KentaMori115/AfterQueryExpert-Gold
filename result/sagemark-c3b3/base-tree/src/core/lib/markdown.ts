// Tiny markdown renderer covering the bits we actually want for campaign notes:
// headings up to h3, bold and italic, inline code, fenced code blocks, blockquotes,
// unordered and ordered lists, autolinks, soft line breaks within paragraphs.
// HTML in the source is escaped before any markdown is applied.

export interface RenderOptions {
  // When true, raw URLs become anchor tags.
  autoLink?: boolean
  // Class to apply to every <pre> block.
  codeClass?: string
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

interface ParseContext {
  options: Required<RenderOptions>
}

const DEFAULT_OPTIONS: Required<RenderOptions> = {
  autoLink: true,
  codeClass: 'block whitespace-pre-wrap rounded-soft bg-parchment-100 px-3 py-2 text-xs',
}

export function renderMarkdown(input: string, options: RenderOptions = {}): string {
  if (!input) return ''
  const ctx: ParseContext = { options: { ...DEFAULT_OPTIONS, ...options } }
  const escaped = escapeHtml(input)
  const blocks = splitBlocks(escaped)
  return blocks.map((b) => renderBlock(b, ctx)).join('\n')
}

interface Block {
  kind: 'paragraph' | 'heading' | 'list' | 'olist' | 'quote' | 'code' | 'blank'
  lines: string[]
  meta?: { level?: number; lang?: string }
}

function splitBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      blocks.push({ kind: 'blank', lines: [] })
      i++
      continue
    }
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const collected: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        collected.push(lines[i]!)
        i++
      }
      if (i < lines.length) i++
      blocks.push({ kind: 'code', lines: collected, meta: { lang } })
      continue
    }
    if (/^#{1,3} /.test(line)) {
      const match = /^(#{1,3}) (.*)$/.exec(line)
      if (match) {
        blocks.push({ kind: 'heading', lines: [match[2]!], meta: { level: match[1]!.length } })
        i++
        continue
      }
    }
    if (/^&gt; /.test(line) || /^> /.test(line)) {
      const collected: string[] = []
      while (i < lines.length && (lines[i]!.startsWith('&gt; ') || lines[i]!.startsWith('> '))) {
        collected.push(lines[i]!.replace(/^&gt; ?|^> ?/, ''))
        i++
      }
      blocks.push({ kind: 'quote', lines: collected })
      continue
    }
    if (/^[-*] /.test(line)) {
      const collected: string[] = []
      while (i < lines.length && /^[-*] /.test(lines[i]!)) {
        collected.push(lines[i]!.replace(/^[-*] /, ''))
        i++
      }
      blocks.push({ kind: 'list', lines: collected })
      continue
    }
    if (/^\d+\. /.test(line)) {
      const collected: string[] = []
      while (i < lines.length && /^\d+\. /.test(lines[i]!)) {
        collected.push(lines[i]!.replace(/^\d+\. /, ''))
        i++
      }
      blocks.push({ kind: 'olist', lines: collected })
      continue
    }
    const collected: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.startsWith('```') &&
      !/^#{1,3} /.test(lines[i]!) &&
      !/^[-*] /.test(lines[i]!) &&
      !/^\d+\. /.test(lines[i]!) &&
      !/^&gt; /.test(lines[i]!) &&
      !/^> /.test(lines[i]!)
    ) {
      collected.push(lines[i]!)
      i++
    }
    blocks.push({ kind: 'paragraph', lines: collected })
  }
  return blocks
}

function renderBlock(block: Block, ctx: ParseContext): string {
  switch (block.kind) {
    case 'blank':
      return ''
    case 'heading': {
      const level = block.meta?.level ?? 3
      const tag = `h${Math.min(level, 3)}`
      return `<${tag}>${inline(block.lines[0] ?? '', ctx)}</${tag}>`
    }
    case 'list': {
      const items = block.lines.map((l) => `<li>${inline(l, ctx)}</li>`).join('')
      return `<ul class="list-disc list-inside">${items}</ul>`
    }
    case 'olist': {
      const items = block.lines.map((l) => `<li>${inline(l, ctx)}</li>`).join('')
      return `<ol class="list-decimal list-inside">${items}</ol>`
    }
    case 'quote': {
      const inner = inline(block.lines.join(' '), ctx)
      return `<blockquote class="border-l-4 border-parchment-300 pl-3 italic text-ink-600">${inner}</blockquote>`
    }
    case 'code': {
      const codeBody = block.lines.join('\n')
      return `<pre class="${ctx.options.codeClass}"><code>${codeBody}</code></pre>`
    }
    case 'paragraph':
    default: {
      return `<p>${inline(block.lines.join(' '), ctx)}</p>`
    }
  }
}

function inline(text: string, ctx: ParseContext): string {
  // Inline code first so its contents do not get mangled by the bold/italic passes below.
  let out = text.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
  // Strong, then emphasis. Two stars handled before one star so the greedy match works.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
  out = out.replace(/_([^_]+)_/g, '<em>$1</em>')
  // Explicit links: [label](href). Limited to http(s) so we do not autolink relative paths.
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
  )
  // autolink remaining bare urls
  // TODO: the lookbehind here is fragile under malformed input. Swap it for a
  // proper token walk once the markdown surface grows beyond what one regex
  // pass can carry safely.
  if (ctx.options.autoLink) {
    out = out.replace(
      /(?<!href=")\b(https?:\/\/[^\s<]+)/g,
      '<a href="$1" rel="noopener noreferrer" target="_blank">$1</a>',
    )
  }
  return out
}

export function stripMarkdown(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/[*_]([^*_]+)[*_]/g, '$1')
    .replace(/^#{1,3} /gm, '')
    .replace(/^[-*] /gm, '')
    .replace(/^\d+\. /gm, '')
    .replace(/^>+ /gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
