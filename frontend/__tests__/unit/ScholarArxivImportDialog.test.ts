import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ScholarArxivImportDialog as ScholarArxivImportDialogClass } from '@/theia/scholar-extension/src/browser/scholar-arxiv-import-dialog'

let ScholarArxivImportDialog: typeof ScholarArxivImportDialogClass

beforeAll(async () => {
  vi.stubGlobal('DragEvent', class DragEvent extends Event {})
  document.queryCommandSupported = vi.fn(() => false)
  ;({ ScholarArxivImportDialog } = await import(
    '@/theia/scholar-extension/src/browser/scholar-arxiv-import-dialog'
  ))
})

afterAll(() => {
  vi.unstubAllGlobals()
  delete (document as Partial<Document>).queryCommandSupported
})

describe('ScholarArxivImportDialog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces lookup and displays the resolved paper title', async () => {
    vi.useFakeTimers()
    const lookupTitle = vi.fn().mockResolvedValue('A Resolved Paper Title')
    const dialog = new ScholarArxivImportDialog({ title: 'Import from arXiv', lookupTitle })
    const internals = dialog as unknown as {
      inputField: HTMLInputElement
      previewNode: HTMLDivElement
      schedulePreview: () => void
    }
    internals.inputField.value = 'https://arxiv.org/abs/2401.00001'

    internals.schedulePreview()
    expect(internals.previewNode.textContent).toBe('Checking arXiv…')
    await vi.advanceTimersByTimeAsync(350)

    expect(lookupTitle).toHaveBeenCalledWith('https://arxiv.org/abs/2401.00001')
    expect(internals.previewNode.textContent).toBe('Paper: A Resolved Paper Title')
    dialog.dispose()
  })
})