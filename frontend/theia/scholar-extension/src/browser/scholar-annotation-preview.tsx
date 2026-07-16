import * as React from 'react'

import { LatexText } from '../../../../components/reader/LatexText'

export interface ScholarAnnotationPreviewProps {
  targetText: string
  annotation?: string
}

export function ScholarAnnotationPreview({
  targetText,
  annotation,
}: ScholarAnnotationPreviewProps): React.ReactElement {
  const target = targetText.trim()
  const content = annotation?.trim() ?? ''

  return (
    <span className="scholar-tree-comment-preview">
      {target && (
        <LatexText text={target} className="scholar-tree-comment-target" />
      )}
      {target && content && (
        <span className="scholar-tree-comment-separator" aria-hidden="true"> — </span>
      )}
      {content && (
        <LatexText text={content} className="scholar-tree-comment-content" />
      )}
    </span>
  )
}