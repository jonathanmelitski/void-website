/**
 * Canonical tiptap-prose CSS for newsletters.
 * Used by: public page, manage preview, and HTML export.
 * Edit here — all three will reflect the change automatically.
 */
export const PROSE_CSS = `
  @import url("https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap");

  .tiptap-prose {
    font-family: "DM Sans", sans-serif;
    font-size: 1rem;
    line-height: 1.6;
    color: rgba(255,255,255,0.85);
  }

  /* Paragraphs — matches paragraph-node.scss */
  .tiptap-prose p { margin-top: 20px; font-size: 1rem; line-height: 1.6; font-weight: normal; }
  .tiptap-prose p:first-child { margin-top: 0; }

  /* Headings — matches heading-node.scss */
  .tiptap-prose h1 { font-size: 1.5em; font-weight: 700; margin-top: 3em; line-height: 1.2; }
  .tiptap-prose h2 { font-size: 1.25em; font-weight: 700; margin-top: 2.5em; line-height: 1.3; }
  .tiptap-prose h3 { font-size: 1.125em; font-weight: 600; margin-top: 2em; line-height: 1.4; }
  .tiptap-prose h4 { font-size: 1em; font-weight: 600; margin-top: 2em; }
  .tiptap-prose h1:first-child,
  .tiptap-prose h2:first-child,
  .tiptap-prose h3:first-child,
  .tiptap-prose h4:first-child { margin-top: 0; }

  /* Lists — matches list-node.scss */
  .tiptap-prose ul, .tiptap-prose ol { margin-top: 1.5em; margin-bottom: 1.5em; padding-left: 1.5em; }
  .tiptap-prose ul:first-child, .tiptap-prose ol:first-child { margin-top: 0; }
  .tiptap-prose ul:last-child, .tiptap-prose ol:last-child { margin-bottom: 0; }
  .tiptap-prose ul ul, .tiptap-prose ul ol, .tiptap-prose ol ul, .tiptap-prose ol ol { margin-top: 0; margin-bottom: 0; }
  .tiptap-prose li p { margin-top: 0; line-height: 1.6; }
  .tiptap-prose ul:not([data-type="taskList"]) { list-style: disc; }
  .tiptap-prose ol { list-style: decimal; }
  .tiptap-prose ul[data-type="taskList"] { list-style: none; padding-left: 0.25em; }
  .tiptap-prose ul[data-type="taskList"] > li { display: flex; flex-direction: row; align-items: flex-start; }
  .tiptap-prose ul[data-type="taskList"] > li > label { padding-top: 0.375rem; padding-right: 0.5rem; }
  .tiptap-prose ul[data-type="taskList"] > li > div { flex: 1 1 0%; min-width: 0; }
  .tiptap-prose ul[data-type="taskList"] > li[data-checked="true"] > div > p { opacity: 0.5; text-decoration: line-through; }

  /* Blockquote — matches blockquote-node.scss */
  .tiptap-prose blockquote {
    position: relative;
    padding-left: 1em;
    padding-top: 0.375em;
    padding-bottom: 0.375em;
    margin: 1.5rem 0;
  }
  .tiptap-prose blockquote p { margin-top: 0; }
  .tiptap-prose blockquote::before {
    content: "";
    position: absolute;
    top: 0; bottom: 0; left: 0;
    width: 0.25em;
    background-color: rgba(245,245,245,0.3);
    border-radius: 0;
  }

  /* Inline marks */
  .tiptap-prose strong { font-weight: 700; }
  .tiptap-prose em { font-style: italic; }
  .tiptap-prose s { text-decoration: line-through; }
  .tiptap-prose u { text-decoration: underline; }
  .tiptap-prose sub { font-size: 0.75em; vertical-align: sub; }
  .tiptap-prose sup { font-size: 0.75em; vertical-align: super; }
  .tiptap-prose mark { border-radius: 2px; padding: 0 2px; }

  /* Links */
  .tiptap-prose a { color: rgba(122,82,255,1); text-decoration: underline; }
  .tiptap-prose a:hover { color: rgba(157,138,255,1); }

  /* Inline code */
  .tiptap-prose code {
    background-color: rgba(231,231,243,0.07);
    color: rgba(251,251,254,0.75);
    border: 1px solid rgba(238,238,246,0.11);
    font-family: "JetBrains Mono NL", monospace;
    font-size: 0.875em;
    line-height: 1.4;
    border-radius: 6px;
    padding: 0.1em 0.2em;
  }

  /* Code blocks */
  .tiptap-prose pre {
    background-color: rgba(232,232,253,0.05);
    color: rgba(253,253,253,0.88);
    border: 1px solid rgba(238,238,246,0.11);
    margin-top: 1.5em;
    margin-bottom: 1.5em;
    padding: 1em;
    font-size: 1rem;
    border-radius: 6px;
    overflow-x: auto;
  }
  .tiptap-prose pre code {
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }

  /* HR */
  .tiptap-prose hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 2em 0; }

  /* Images */
  .tiptap-prose img { max-width: 100%; height: auto; display: block; border-radius: 6px; margin: 2rem 0; }
  .tiptap-prose img[data-align="center"] { margin-left: auto; margin-right: auto; }
  .tiptap-prose img[data-align="right"] { margin-left: auto; margin-right: 0; }

  /* Text alignment */
  .tiptap-prose [style*="text-align: center"] { text-align: center; }
  .tiptap-prose [style*="text-align: right"] { text-align: right; }
  .tiptap-prose [style*="text-align: justify"] { text-align: justify; }
`

/**
 * Light-mode color overrides — applied on top of PROSE_CSS for the light export theme.
 */
export const PROSE_CSS_LIGHT_OVERRIDES = `
  .tiptap-prose { color: #333333; }
  .tiptap-prose p { color: #333333; }
  .tiptap-prose h1, .tiptap-prose h2, .tiptap-prose h3, .tiptap-prose h4 { color: #111111; }
  .tiptap-prose ul, .tiptap-prose ol { color: #333333; }
  .tiptap-prose blockquote::before { background-color: #cccccc; }
  .tiptap-prose blockquote p { color: #555555; }
  .tiptap-prose a { color: #6B46FF; }
  .tiptap-prose a:hover { color: #4f35cc; }
  .tiptap-prose code { background-color: #f0f0f5; color: #333333; border-color: #e0e0e8; }
  .tiptap-prose pre { background-color: #f5f5f8; color: #333333; border-color: #e0e0e8; }
  .tiptap-prose hr { border-top-color: #e5e5e5; }
`
