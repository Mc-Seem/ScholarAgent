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
    iconClass: 'codicon codicon-refresh',
  } satisfies Command,
  UPLOAD_LATEX: {
    id: 'scholar-agent.upload-latex',
    label: 'Scholar Agent: Upload LaTeX Source',
    iconClass: 'codicon codicon-cloud-upload',
  } satisfies Command,
  IMPORT_ARXIV: {
    id: 'scholar-agent.import-arxiv',
    label: 'Scholar Agent: Import from arXiv',
    iconClass: 'codicon codicon-link',
  } satisfies Command,
  OPEN_PAPER: {
    id: 'scholar-agent.open-paper',
    label: 'Open',
    iconClass: 'codicon codicon-go-to-file',
  } satisfies Command,
  OPEN_PAPER_TO_SIDE: {
    id: 'scholar-agent.open-paper-to-side',
    label: 'Open to the Side',
    iconClass: 'codicon codicon-split-horizontal',
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
  COMPILE_PAPER: {
    id: 'scholar-agent.compile-paper',
    label: 'Recompile Paper',
    iconClass: 'codicon codicon-refresh',
  } satisfies Command,
  BUILD_KNOWLEDGE_GRAPH: {
    id: 'scholar-agent.build-knowledge-graph',
    label: 'Build Knowledge Graph',
    iconClass: 'codicon codicon-combine',
  } satisfies Command,
  DELETE_PAPER: {
    id: 'scholar-agent.delete-paper',
    label: 'Delete Paper',
    iconClass: 'codicon codicon-trash',
  } satisfies Command,
  OPEN_GRAPH: {
    id: 'scholar-agent.open-graph',
    label: 'Open Knowledge Graph',
    iconClass: 'codicon codicon-type-hierarchy',
  } satisfies Command,
}