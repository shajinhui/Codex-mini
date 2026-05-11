import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false
})

const defaultFenceRenderer =
  markdown.renderer.rules.fence ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

markdown.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const info = token.info ? markdown.utils.unescapeAll(token.info).trim() : ''
  const language = info ? info.split(/\s+/g)[0] : ''
  const label = language || 'text'

  return [
    '<div class="code-block">',
    '<div class="code-block-header">',
    `<span>${markdown.utils.escapeHtml(label)}</span>`,
    '<button class="code-copy-button" type="button" data-copy-code="true">复制</button>',
    '</div>',
    defaultFenceRenderer(tokens, idx, options, env, self),
    '</div>'
  ].join('')
}

export function renderMarkdown(source: string): string {
  return DOMPurify.sanitize(markdown.render(source))
}
