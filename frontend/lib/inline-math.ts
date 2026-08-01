/**
 * Wraps bare LaTeX fragments in inline math delimiters.
 *
 * Extraction prompts ask the model for `$...$` around every mathematical
 * fragment, but existing knowledge graphs (and the occasional model slip)
 * still store meanings such as `token in the rejected sequence y_l`. Without
 * delimiters MathJax leaves them as literal text, so notation tables show raw
 * LaTeX instead of symbols.
 *
 * The heuristic is deliberately narrow: a token is wrapped only when the whole
 * token looks like a symbol with a sub/superscript or a LaTeX command. Prose
 * words, `snake_case` identifiers and already-delimited math are left alone.
 */

type Delimiter = readonly [opening: string, closing: string]

const DELIMITERS: readonly Delimiter[] = [
  ['$$', '$$'],
  ['\\[', '\\]'],
  ['\\(', '\\)'],
  ['$', '$'],
]

const ATOM = String.raw`(?:\\[A-Za-z]+|[A-Za-z0-9]|\{[^{}]*\})`
const MATH_TOKEN = new RegExp(
  String.raw`^(?:\\[A-Za-z]+|[A-Za-z])(?:\{[^{}]*\})?(?:[_^]${ATOM})*$`,
)
const LATEX_COMMAND = /\\[A-Za-z]/
const SCRIPT = /[_^]/
const LEADING_PUNCTUATION = /^[([{"'“„«]+/
const TRAILING_PUNCTUATION = /[)\]}"'”“»,.;:!?]$/

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    backslashes += 1
  }
  return backslashes % 2 === 1
}

function looksLikeMath(token: string): boolean {
  if (!token || token.includes('$')) {
    return false
  }
  if (!LATEX_COMMAND.test(token) && !SCRIPT.test(token)) {
    return false
  }
  return MATH_TOKEN.test(token)
}

function wrapToken(token: string): string {
  const leading = LEADING_PUNCTUATION.exec(token)?.[0] ?? ''
  let core = token.slice(leading.length)
  let trailing = ''
  // Give up trailing characters one at a time: `y_{i,t}` ends with a brace that
  // belongs to the math, while `m_s)` and `x^2.` end with prose punctuation.
  while (core) {
    if (looksLikeMath(core)) {
      return `${leading}$${core}$${trailing}`
    }
    if (!TRAILING_PUNCTUATION.test(core)) {
      break
    }
    trailing = core.slice(-1) + trailing
    core = core.slice(0, -1)
  }
  return token
}

function wrapPlainSegment(segment: string): string {
  return segment.replace(/\S+/g, wrapToken)
}

/**
 * Returns `text` with bare math tokens wrapped in `$...$`.
 * Fragments already inside math delimiters are copied verbatim.
 */
export function wrapBareMath(text: string): string {
  if (!text) {
    return text
  }
  let result = ''
  let plain = ''
  let cursor = 0

  const flushPlain = (): void => {
    if (plain) {
      result += wrapPlainSegment(plain)
      plain = ''
    }
  }

  while (cursor < text.length) {
    const delimiter = DELIMITERS.find(
      ([opening]) => text.startsWith(opening, cursor) && !isEscaped(text, cursor),
    )
    if (!delimiter) {
      plain += text[cursor]
      cursor += 1
      continue
    }
    const [opening, closing] = delimiter
    const closingIndex = text.indexOf(closing, cursor + opening.length)
    if (closingIndex < 0) {
      plain += text[cursor]
      cursor += 1
      continue
    }
    flushPlain()
    result += text.slice(cursor, closingIndex + closing.length)
    cursor = closingIndex + closing.length
  }

  flushPlain()
  return result
}

/**
 * Normalizes a standalone math expression to explicit MathJax delimiters.
 * Any delimiters already present are stripped first so that stored values such
 * as `$x$` and `x` render identically.
 */
export function toMathSource(value: string, display = false): string {
  let source = value.trim()
  for (const [opening, closing] of DELIMITERS) {
    if (
      source.length > opening.length + closing.length
      && source.startsWith(opening)
      && source.endsWith(closing)
    ) {
      source = source.slice(opening.length, -closing.length).trim()
      break
    }
  }
  return display ? `\\[${source}\\]` : `\\(${source}\\)`
}
