const MATHJAX_SCRIPT_ID = 'scholar-mathjax-script'

export function ensureMathJax(): void {
  if (typeof window === 'undefined' || document.getElementById(MATHJAX_SCRIPT_ID)) {
    return
  }

  if (!window.MathJax?.typesetPromise) {
    ;(window as unknown as { MathJax: unknown }).MathJax = {
      tex: {
        inlineMath: [['$', '$'], ['\\(', '\\)']],
        displayMath: [['$$', '$$'], ['\\[', '\\]']],
        processEnvironments: true,
        packages: { '[+]': ['base', 'ams', 'noerrors', 'noundefined'] },
      },
      options: {
        enableMenu: false,
        enableEnrichment: true,
        renderActions: { addMenu: [] },
      },
      chtml: {
        fontURL: 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/output/chtml/fonts/woff-v2',
      },
      startup: {
        pageReady: async () => {
          const mathJax = (window as unknown as {
            MathJax: { startup: { defaultPageReady: () => Promise<void> } }
          }).MathJax
          await mathJax.startup.defaultPageReady()
          window.dispatchEvent(new CustomEvent('MathJaxReady'))
        },
      },
    }
  }

  const script = document.createElement('script')
  script.id = MATHJAX_SCRIPT_ID
  script.async = true
  script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js'
  document.head.appendChild(script)
}