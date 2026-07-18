import { AbstractDialog, DialogProps } from '@theia/core/lib/browser'
import type { DialogError, DialogMode, Message } from '@theia/core/lib/browser'
import type { MaybePromise } from '@theia/core'

/**
 * Props for {@link ScholarTextareaDialog}. Mirrors Theia's built-in
 * `SingleTextInputDialogProps`, but for a multiline value.
 */
export interface ScholarTextareaDialogProps extends DialogProps {
  readonly confirmButtonLabel?: string
  readonly initialValue?: string
  readonly placeholder?: string
  /** Visible rows of the textarea. Defaults to a generously sized field. */
  readonly rows?: number
  readonly validate?: (input: string, mode: DialogMode) => MaybePromise<DialogError>
}

/**
 * A multiline counterpart to Theia's `SingleTextInputDialog`, which only
 * renders a single-line `<input>` and is too small for free-form prompts
 * such as "describe your expertise" for AI tooltip suggestion generation.
 */
export class ScholarTextareaDialog extends AbstractDialog<string> {

  protected readonly textareaField: HTMLTextAreaElement

  constructor(
    protected override readonly props: ScholarTextareaDialogProps,
  ) {
    super(props)

    this.textareaField = document.createElement('textarea')
    this.textareaField.className = 'theia-input scholar-textarea-dialog-field'
    this.textareaField.spellcheck = true
    this.textareaField.rows = props.rows ?? 8
    this.textareaField.setAttribute(
      'style',
      'flex: 0; width: 100%; min-height: 12rem; resize: vertical; box-sizing: border-box;',
    )
    this.textareaField.placeholder = props.placeholder ?? ''
    this.textareaField.value = props.initialValue ?? ''

    this.contentNode.appendChild(this.textareaField)
    this.controlPanel.removeChild(this.errorMessageNode)
    this.contentNode.appendChild(this.errorMessageNode)

    this.appendAcceptButton(props.confirmButtonLabel)
  }

  get value(): string {
    return this.textareaField.value
  }

  protected override isValid(value: string, mode: DialogMode): MaybePromise<DialogError> {
    if (this.props.validate) {
      return this.props.validate(value, mode)
    }
    return super.isValid(value, mode)
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg)
    this.addUpdateListener(this.textareaField, 'input')
  }

  protected override onActivateRequest(msg: Message): void {
    void msg
    this.textareaField.focus()
    this.textareaField.select()
  }

  // Note: the base `AbstractDialog.handleEnter` already leaves Enter alone
  // (returns `false`, i.e. inserts a newline) when the active element is a
  // `<textarea>`, so no override is needed here to keep multi-line typing
  // usable; the dialog is confirmed via the accept button (or Ctrl/Cmd+Enter
  // is not intercepted either, matching plain textarea behavior).
}
