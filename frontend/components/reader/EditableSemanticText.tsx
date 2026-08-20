'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Pencil, RotateCcw } from 'lucide-react'

/**
 * One text about one semantic subject, with the reader's own wording winning
 * over the agent's.
 *
 * The lens shows a single text per subject rather than an agent card plus a
 * reader card: two competing explanations of the same symbol force the reader
 * to decide which one to trust. The agent's text stays retrievable behind
 * `Show original`, and `Restore` drops the reader's wording entirely.
 */
export interface SemanticTextEditor {
  /** Reader wording per subject stable id; absent means the agent's text shows. */
  notesBySubjectId: Record<string, string>
  onSave(subjectId: string, content: string, targetText?: string | null): Promise<void> | void
  onRestore(subjectId: string): Promise<void> | void
}

interface EditableSemanticTextProps {
  subjectId: string
  /** What the agent produced for this subject; empty when it produced nothing. */
  agentText: string
  /** Names the edited text for assistive technology, e.g. `explanation of SLIME`. */
  label: string
  editor?: SemanticTextEditor
  /** Wrapper element, so the text keeps its place in headings and definition lists. */
  as?: 'div' | 'h3' | 'h4' | 'dd' | 'p'
  className?: string
  /** Renders the text, typically through MathJax. Defaults to plain text. */
  renderText?: (text: string) => ReactNode
  /** Extra content shown next to the text while not editing. */
  children?: ReactNode
  /** Target text stored alongside the note, usually the subject label. */
  targetText?: string | null
}

const EMPTY_AGENT_TEXT = 'No description yet.'

export function EditableSemanticText({
  subjectId,
  agentText,
  label,
  editor,
  as: Wrapper = 'div',
  className,
  renderText,
  children,
  targetText,
}: EditableSemanticTextProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)

  // The lens reuses this component across selections, so a draft left open for
  // one symbol must never be saved onto the next one.
  useEffect(() => {
    setDraft(null)
    setBusy(false)
    setError(null)
    setShowOriginal(false)
  }, [subjectId])

  const readerText = editor?.notesBySubjectId[subjectId]?.trim() ?? ''
  const agent = agentText.trim()
  const text = readerText || agent
  const edited = Boolean(readerText) && readerText !== agent
  const render = renderText ?? ((value: string) => value)
  const classes = ['semantic-editable', className].filter(Boolean).join(' ')

  const run = async (action: () => Promise<void> | void): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setDraft(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  if (draft !== null && editor) {
    const trimmed = draft.trim()
    const save = () => {
      if (!trimmed) return
      void run(() => editor.onSave(subjectId, trimmed, targetText))
    }
    return (
      <Wrapper
        className={`${classes} semantic-editable-editing`}
        data-testid="semantic-editable"
        data-subject-id={subjectId}
      >
        <textarea
          className="semantic-editable-input"
          data-testid="semantic-editable-input"
          aria-label={`Edit ${label}`}
          value={draft}
          rows={3}
          autoFocus
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(null)
              setError(null)
              return
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              save()
            }
          }}
        />
        {error && <span className="semantic-editable-error">{error}</span>}
        <span className="semantic-editable-actions">
          <button
            type="button"
            className="semantic-editable-action"
            data-testid="semantic-editable-save"
            disabled={busy || !trimmed}
            onClick={save}
          >
            Save
          </button>
          <button
            type="button"
            className="semantic-editable-action"
            data-testid="semantic-editable-cancel"
            disabled={busy}
            onClick={() => {
              setDraft(null)
              setError(null)
            }}
          >
            Cancel
          </button>
        </span>
      </Wrapper>
    )
  }

  return (
    <Wrapper className={classes} data-testid="semantic-editable" data-subject-id={subjectId}>
      {text
        ? <span className="semantic-editable-text">{render(text)}</span>
        : <span className="semantic-editable-empty">{EMPTY_AGENT_TEXT}</span>}
      {children}
      {editor && (
        <span className="semantic-editable-actions">
          {edited && (
            <>
              <span className="semantic-editable-badge" data-testid="semantic-editable-badge">
                edited
              </span>
              <button
                type="button"
                className="semantic-editable-action"
                data-testid="semantic-editable-original"
                onClick={() => setShowOriginal(value => !value)}
              >
                {showOriginal ? 'Hide original' : 'Show original'}
              </button>
              <button
                type="button"
                className="semantic-editable-action"
                data-testid="semantic-editable-restore"
                aria-label={`Restore agent text for ${label}`}
                disabled={busy}
                onClick={() => void run(() => editor.onRestore(subjectId))}
              >
                <RotateCcw size={11} /> Restore
              </button>
            </>
          )}
          <button
            type="button"
            className="semantic-editable-action"
            data-testid="semantic-editable-edit"
            aria-label={`${text ? 'Edit' : 'Add'} ${label}`}
            disabled={busy}
            onClick={() => setDraft(text)}
          >
            <Pencil size={11} /> {text ? 'Edit' : 'Add'}
          </button>
        </span>
      )}
      {edited && showOriginal && (
        <span className="semantic-editable-original" data-testid="semantic-editable-agent-text">
          {agent ? render(agent) : EMPTY_AGENT_TEXT}
        </span>
      )}
      {error && <span className="semantic-editable-error">{error}</span>}
    </Wrapper>
  )
}
