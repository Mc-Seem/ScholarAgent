import { describe, expect, it } from 'vitest'

import { ScholarAnnotationService } from '@/theia/scholar-extension/src/browser/scholar-annotation-service'

describe('ScholarAnnotationService', () => {
  it('keeps the selected annotation visible when editing is cancelled', () => {
    const service = new ScholarAnnotationService()

    service.select('paper-1', 'tooltip-1')
    expect(service.currentSelection).toEqual({ paperId: 'paper-1', tooltipId: 'tooltip-1' })
    expect(service.currentDraft).toBeUndefined()

    service.edit('paper-1', 'tooltip-1', 'Comment', 'Attached passage')
    expect(service.currentSelection).toEqual({ paperId: 'paper-1', tooltipId: 'tooltip-1' })
    expect(service.currentDraft?.mode).toBe('edit')

    service.cancelDraft()
    expect(service.currentDraft).toBeUndefined()
    expect(service.currentSelection).toEqual({ paperId: 'paper-1', tooltipId: 'tooltip-1' })
  })

  it('replaces a selection with a new draft and clears both states explicitly', () => {
    const service = new ScholarAnnotationService()

    service.select('paper-1', 'tooltip-1')
    service.create('paper-1', 'paragraph-2', 'New target')

    expect(service.currentSelection).toBeUndefined()
    expect(service.currentDraft).toMatchObject({
      mode: 'create',
      paperId: 'paper-1',
      domNodeId: 'paragraph-2',
    })

    service.clear()
    expect(service.currentSelection).toBeUndefined()
    expect(service.currentDraft).toBeUndefined()
  })
})