import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { ScholarTextareaDialog as ScholarTextareaDialogClass } from '@/theia/scholar-extension/src/browser/scholar-textarea-dialog'

let ScholarTextareaDialog: typeof ScholarTextareaDialogClass

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ScholarTextareaDialog } = await import(
    '@/theia/scholar-extension/src/browser/scholar-textarea-dialog'
  ))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ScholarTextareaDialog', () => {
  it('renders a multiline textarea with a generous height instead of a single-line input', () => {
    const dialog = new ScholarTextareaDialog({
      title: 'Generate AI Tooltip Suggestions',
      initialValue: 'Prior expertise',
    })

    const textarea = dialog.node.querySelector('textarea')
    expect(textarea).toBeTruthy()
    expect(dialog.node.querySelector('input')).toBeNull()
    expect(textarea?.value).toBe('Prior expertise')

    // Reproduces & guards the nitpick: the field must be tall enough for a
    // multi-sentence prompt, not a cramped single input row.
    expect(textarea?.rows ?? 0).toBeGreaterThanOrEqual(4)
    expect(textarea?.getAttribute('style') ?? '').toMatch(/min-height:\s*12rem/)

    dialog.dispose()
  })

  it('exposes the current textarea content as its value, live as the user types', () => {
    const dialog = new ScholarTextareaDialog({ title: 'Prompt' })
    const textarea = dialog.node.querySelector('textarea') as HTMLTextAreaElement

    textarea.value = 'Line one\nLine two'
    expect(dialog.value).toBe('Line one\nLine two')

    dialog.dispose()
  })

  it('delegates validation to the provided validate function', async () => {
    const validate = vi.fn().mockReturnValue('Expertise is required.')
    const dialog = new ScholarTextareaDialog({ title: 'Prompt', validate })

    // isValid is protected; cast to access it the same way the codebase
    // exercises SingleTextInputDialog's validate hook in existing tests.
    const result = await (dialog as unknown as {
      isValid(value: string, mode: 'open' | 'preview'): unknown
    }).isValid('', 'preview')

    expect(validate).toHaveBeenCalledWith('', 'preview')
    expect(result).toBe('Expertise is required.')

    dialog.dispose()
  })

  it('honors a custom row count and placeholder', () => {
    const dialog = new ScholarTextareaDialog({
      title: 'Prompt',
      rows: 12,
      placeholder: 'Describe your expertise…',
    })
    const textarea = dialog.node.querySelector('textarea') as HTMLTextAreaElement

    expect(textarea.rows).toBe(12)
    expect(textarea.placeholder).toBe('Describe your expertise…')

    dialog.dispose()
  })
})
