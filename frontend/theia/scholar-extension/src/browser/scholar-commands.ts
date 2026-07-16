import type { Command } from '@theia/core'

export const ScholarCommands = {
  SHOW_LIBRARY: {
    id: 'scholar-agent.show-library',
    label: 'Scholar Agent: Show Papers',
  } satisfies Command,
  SHOW_NAVIGATION: {
    id: 'scholar-agent.show-navigation',
    label: 'Scholar Agent: Show Navigation',
  } satisfies Command,
  SHOW_ANNOTATIONS: {
    id: 'scholar-agent.show-annotations',
    label: 'Scholar Agent: Show Annotations',
  } satisfies Command,
  REFRESH_LIBRARY: {
    id: 'scholar-agent.refresh-library',
    label: 'Scholar Agent: Refresh Paper Library',
  } satisfies Command,
  FIND_IN_PAPER: {
    id: 'scholar-agent.find-in-paper',
    label: 'Find in Paper',
    iconClass: 'codicon codicon-search',
  } satisfies Command,
  ADD_ANNOTATION: {
    id: 'scholar-agent.add-annotation',
    label: 'Add Annotation',
    iconClass: 'codicon codicon-comment-add',
  } satisfies Command,
  EDIT_ANNOTATION: {
    id: 'scholar-agent.edit-annotation',
    label: 'Edit Annotation',
    iconClass: 'codicon codicon-edit',
  } satisfies Command,
  TOGGLE_ANNOTATION_PIN: {
    id: 'scholar-agent.toggle-annotation-pin',
    label: 'Pin or Unpin Annotation',
    iconClass: 'codicon codicon-pin',
  } satisfies Command,
  OPEN_ANNOTATION: {
    id: 'scholar-agent.open-annotation',
    label: 'Reveal in Paper',
    iconClass: 'codicon codicon-go-to-file',
  } satisfies Command,
  DELETE_ANNOTATION: {
    id: 'scholar-agent.delete-annotation',
    label: 'Delete Annotation',
    iconClass: 'codicon codicon-trash',
  } satisfies Command,
  REMOVE_ANNOTATION_OCCURRENCE: {
    id: 'scholar-agent.remove-annotation-occurrence',
    label: 'Remove from This Occurrence',
    iconClass: 'codicon codicon-remove',
  } satisfies Command,
}