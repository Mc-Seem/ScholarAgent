import type { Message } from '@theia/core/lib/browser'
import { AbstractDialog, DialogProps } from '@theia/core/lib/browser'

import { apiUrl } from '../../../../hooks/useApi'

export interface ScholarArxivImportDialogProps extends DialogProps {
  readonly lookupTitle?: (value: string) => Promise<string | undefined>
}

export class ScholarArxivImportDialog extends AbstractDialog<string> {
  protected readonly inputField: HTMLInputElement
  protected readonly previewNode: HTMLDivElement
  private previewTimer: ReturnType<typeof setTimeout> | undefined
  private previewRequest = 0

  constructor(protected override readonly props: ScholarArxivImportDialogProps) {
    super(props)
    this.inputField = document.createElement('input')
    this.inputField.className = 'theia-input'
    this.inputField.placeholder = 'arXiv id or URL'

    this.previewNode = document.createElement('div')
    this.previewNode.className = 'scholar-arxiv-preview'
    this.previewNode.setAttribute('aria-live', 'polite')

    this.contentNode.append(this.inputField, this.previewNode)
    this.controlPanel.removeChild(this.errorMessageNode)
    this.contentNode.appendChild(this.errorMessageNode)
    this.appendAcceptButton('Import')
  }

  get value(): string {
    return this.inputField.value
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.addUpdateListener(this.inputField, 'input')
    this.inputField.addEventListener('input', this.schedulePreview)
  }

  protected override onActivateRequest(msg: Message): void {
    void msg
    this.inputField.focus()
  }

  override dispose(): void {
    clearTimeout(this.previewTimer)
    this.inputField.removeEventListener('input', this.schedulePreview)
    super.dispose()
  }

  private readonly schedulePreview = (): void => {
    clearTimeout(this.previewTimer)
    const value = this.value.trim()
    const request = ++this.previewRequest
    this.previewNode.textContent = value ? 'Checking arXiv…' : ''
    if (!value) {
      return
    }
    this.previewTimer = setTimeout(() => {
      void (this.props.lookupTitle ?? lookupArxivTitle)(value).then(title => {
        if (request === this.previewRequest) {
          this.previewNode.textContent = title ? `Paper: ${title}` : 'Paper not found'
        }
      }).catch(() => {
        if (request === this.previewRequest) {
          this.previewNode.textContent = 'Could not load title preview'
        }
      })
    }, 350)
  }
}

async function lookupArxivTitle(value: string): Promise<string | undefined> {
  const response = await fetch(apiUrl(`/api/arxiv/metadata?url_or_id=${encodeURIComponent(value)}`))
  if (!response.ok) {
    return undefined
  }
  const payload = await response.json() as { title?: unknown }
  return typeof payload.title === 'string' ? payload.title : undefined
}