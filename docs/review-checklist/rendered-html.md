# Content rendered as HTML

- paths: `^web/src/`
- adds: `dangerouslySetInnerHTML|innerHTML|rehype-raw|rehypeRaw|srcdoc|insertAdjacentHTML|document\.write`

Chat content comes from a model and from tools, so it is untrusted. `rehype-sanitize` stays in front of rendered
Markdown, and HTML from a chat goes in the sandboxed frame, never into the page. Check what a reply holding a
`<script>`, an `onerror=` attribute or a `javascript:` link does with this change.
