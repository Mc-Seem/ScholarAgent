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
  SHOW_SEMANTIC_LENS: {
    id: 'scholar-agent.show-semantic-lens',
    label: 'Scholar Agent: Show Semantic Lens',
  } satisfies Command,
  SHOW_CHAT: {
    id: 'scholar-agent.show-chat',
    label: 'Scholar Agent: Show Chat',
  } satisfies Command,
  SHOW_ANNOTATIONS: {
    id: 'scholar-agent.show-annotations',
    label: 'Scholar Agent: Show Annotations',
  } satisfies Command,
  SHOW_READING_SETS: {
    id: 'scholar-agent.show-reading-sets',
    label: 'Scholar Agent: Show Reading Sets',
  } satisfies Command,
  CREATE_READING_SET: {
    id: 'scholar-agent.create-reading-set',
    label: 'Scholar Agent: New Reading Set',
    iconClass: 'codicon codicon-add',
  } satisfies Command,
  REFRESH_READING_SETS: {
    id: 'scholar-agent.refresh-reading-sets',
    label: 'Scholar Agent: Refresh Reading Sets',
    iconClass: 'codicon codicon-refresh',
  } satisfies Command,
  RENAME_READING_SET: {
    id: 'scholar-agent.rename-reading-set',
    label: 'Rename Reading Set',
    iconClass: 'codicon codicon-edit',
  } satisfies Command,
  DELETE_READING_SET: {
    id: 'scholar-agent.delete-reading-set',
    label: 'Delete Reading Set',
    iconClass: 'codicon codicon-trash',
  } satisfies Command,
  ADD_PAPER_TO_READING_SET: {
    id: 'scholar-agent.add-paper-to-reading-set',
    label: 'Add to Reading Set…',
    iconClass: 'codicon codicon-folder-library',
  } satisfies Command,
  REMOVE_PAPER_FROM_READING_SET: {
    id: 'scholar-agent.remove-paper-from-reading-set',
    label: 'Remove from Reading Set',
    iconClass: 'codicon codicon-remove',
  } satisfies Command,
  LINK_READING_SET_TERMS: {
    id: 'scholar-agent.link-reading-set-terms',
    label: 'Link Terms',
    iconClass: 'codicon codicon-link',
  } satisfies Command,
  STOP_READING_SET_TERMS: {
    id: 'scholar-agent.stop-reading-set-terms',
    label: 'Stop Linking Terms',
    iconClass: 'codicon codicon-stop-circle',
  } satisfies Command,
  OPEN_READING_SET_CHAT: {
    id: 'scholar-agent.open-reading-set-chat',
    label: 'Chat About Set',
    iconClass: 'codicon codicon-comment-discussion',
  } satisfies Command,
  HIGHLIGHT_SHARED_TERMS: {
    id: 'scholar-agent.highlight-shared-terms',
    label: 'Scholar Agent: Highlight Shared Terms',
    iconClass: 'codicon codicon-symbol-color',
  } satisfies Command,
  SHOW_TOOLTIP_DRAFTS: {
    id: 'scholar-agent.show-tooltip-drafts',
    label: 'Scholar Agent: Show Term Highlights',
  } satisfies Command,
  OPEN_LLM_SETTINGS: {
    id: 'scholar-agent.open-llm-settings',
    label: 'Scholar Agent: Open LLM Settings',
  } satisfies Command,
  SAVE_LLM_SETTINGS: {
    id: 'scholar-agent.save-llm-settings',
    label: 'Scholar Agent: Save LLM Settings',
    iconClass: 'codicon codicon-save',
  } satisfies Command,
  REVERT_LLM_SETTINGS: {
    id: 'scholar-agent.revert-llm-settings',
    label: 'Scholar Agent: Revert LLM Settings',
    iconClass: 'codicon codicon-discard',
  } satisfies Command,
  REFRESH_LLM_MODELS: {
    id: 'scholar-agent.refresh-llm-models',
    label: 'Scholar Agent: Refresh LLM Models',
    iconClass: 'codicon codicon-refresh',
  } satisfies Command,
  TEST_LLM_KG_EXTRACTION: {
    id: 'scholar-agent.test-llm-kg-extraction',
    label: 'Scholar Agent: Test Knowledge Graph LLM Connection',
    iconClass: 'codicon codicon-debug-start',
  } satisfies Command,
  TEST_LLM_HTML_INJECTION: {
    id: 'scholar-agent.test-llm-html-injection',
    label: 'Scholar Agent: Test HTML Injection LLM Connection',
    iconClass: 'codicon codicon-debug-start',
  } satisfies Command,
  TEST_LLM_TOOLTIP_SUGGESTION: {
    id: 'scholar-agent.test-llm-tooltip-suggestion',
    label: 'Scholar Agent: Test Term Highlights LLM Connection',
    iconClass: 'codicon codicon-debug-start',
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
  STOP_KNOWLEDGE_GRAPH: {
    id: 'scholar-agent.stop-knowledge-graph',
    label: 'Stop Knowledge Graph Build',
    iconClass: 'codicon codicon-debug-stop',
  } satisfies Command,
  REANCHOR_OCCURRENCES: {
    id: 'scholar-agent.reanchor-occurrences',
    label: 'Re-anchor Terms in Paper',
    iconClass: 'codicon codicon-references',
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
  SEARCH_GRAPH: {
    id: 'scholar-agent.search-graph',
    label: 'Search Knowledge Graph',
    iconClass: 'codicon codicon-search',
  } satisfies Command,
  FILTER_GRAPH: {
    id: 'scholar-agent.filter-graph',
    label: 'Filter Knowledge Graph',
    iconClass: 'codicon codicon-filter',
  } satisfies Command,
  TOGGLE_GRAPH_FOCUS: {
    id: 'scholar-agent.toggle-graph-focus',
    label: 'Toggle Graph Focus',
    iconClass: 'codicon codicon-target',
  } satisfies Command,
  RESET_GRAPH_LAYOUT: {
    id: 'scholar-agent.reset-graph-layout',
    label: 'Reset Graph Layout',
    iconClass: 'codicon codicon-layout',
  } satisfies Command,
  REVEAL_GRAPH_SELECTION: {
    id: 'scholar-agent.reveal-graph-selection',
    label: 'Reveal Graph Selection in Paper',
    iconClass: 'codicon codicon-go-to-file',
  } satisfies Command,
  GENERATE_SUGGESTIONS: {
    id: 'scholar-agent.generate-suggestions',
    label: 'Generate AI Term Highlights',
    iconClass: 'codicon codicon-sparkle',
  } satisfies Command,
  APPLY_SUGGESTIONS: {
    id: 'scholar-agent.apply-suggestions',
    label: 'Apply Selected Term Highlights',
    iconClass: 'codicon codicon-check-all',
  } satisfies Command,
  CREATE_MANUAL_SUGGESTION: {
    id: 'scholar-agent.create-manual-suggestion',
    label: 'Create Manual Term Highlight',
    iconClass: 'codicon codicon-add',
  } satisfies Command,
  DELETE_SUGGESTION: {
    id: 'scholar-agent.delete-suggestion',
    label: 'Delete Term Highlight',
    iconClass: 'codicon codicon-trash',
  } satisfies Command,
}