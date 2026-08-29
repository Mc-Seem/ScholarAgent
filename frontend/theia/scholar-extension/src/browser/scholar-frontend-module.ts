import { MessageService, SelectionService } from '@theia/core'
import {
  CommandContribution,
  MenuContribution,
} from '@theia/core/lib/common'
import {
  createTreeContainer,
  ContextMenuRenderer,
  defaultTreeProps,
  FrontendApplicationContribution,
  KeybindingContribution,
  ViewContainer,
  WidgetFactory,
  WidgetManager,
} from '@theia/core/lib/browser'
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar'
import { ContainerModule } from '@theia/core/shared/inversify'

import { HttpReaderWorkspaceApi } from '../../../../lib/reader-workspace-api'
import { HttpLlmSettingsApi } from '../../../../lib/llm-settings-api'
import { HttpChatApi } from '../../../../lib/chat-api'
import { ScholarContribution } from './scholar-contribution'
import { ScholarChatService } from './scholar-chat-service'
import {
  SCHOLAR_CHAT_WIDGET_ID,
  ScholarChatWidget,
} from './scholar-chat-widget'
import { ScholarLlmSettingsService } from './scholar-llm-settings-service'
import {
  SCHOLAR_LLM_SETTINGS_WIDGET_ID,
  ScholarLlmSettingsWidget,
} from './scholar-llm-settings-widget'
import {
  SCHOLAR_ANNOTATIONS_WIDGET_ID,
  SCHOLAR_LIBRARY_CONTEXT_MENU,
  SCHOLAR_LIBRARY_WIDGET_ID,
  SCHOLAR_NAVIGATION_WIDGET_ID,
  SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID,
  ScholarLibraryWidget,
} from './scholar-side-widgets'
import { ScholarAnnotationService } from './scholar-annotation-service'
import { ScholarCitationService } from './scholar-citation-service'
import { ScholarReadingSetService } from './scholar-reading-set-service'
import {
  SCHOLAR_READING_SET_CONTEXT_MENU,
  SCHOLAR_READING_SETS_WIDGET_ID,
  ScholarReadingSetWidget,
} from './scholar-reading-set-widget'
import {
  SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID,
  SCHOLAR_COMMENTS_WIDGET_ID,
  SCHOLAR_GLOSSARY_WIDGET_ID,
  SCHOLAR_OUTLINE_WIDGET_ID,
  SCHOLAR_TREE_CONTEXT_MENU,
  ScholarAnnotationEditorWidget,
  ScholarCommentsWidget,
  ScholarGlossaryWidget,
  ScholarOutlineWidget,
} from './scholar-native-widgets'
import {
  SCHOLAR_PAPER_FACTORY_ID,
  ScholarPaperWidget,
  isScholarPaperWidgetOptions,
} from './scholar-paper-widget'
import {
  SCHOLAR_PAPER_GRAPH_FACTORY_ID,
  ScholarPaperGraphWidget,
  isScholarPaperGraphWidgetOptions,
} from './scholar-paper-graph-widget'
import { ScholarSuggestionService } from './scholar-suggestion-service'
import {
  SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID,
  SCHOLAR_SUGGESTIONS_CONTEXT_MENU,
  SCHOLAR_SUGGESTIONS_WIDGET_ID,
  ScholarSuggestionEditorWidget,
  ScholarSuggestionsTreeWidget,
} from './scholar-suggestion-widgets'
import {
  bindScholarGraphPropertyView,
} from './scholar-graph-property-view'
import {
  SCHOLAR_SEMANTIC_LENS_WIDGET_ID,
  ScholarSemanticLensWidget,
} from './scholar-semantic-lens-widget'
import { ScholarWorkspaceService } from './scholar-workspace-service'
import './style/generated.css'

export default new ContainerModule(bind => {
  bind(HttpReaderWorkspaceApi).toSelf().inSingletonScope()
  bind(HttpLlmSettingsApi).toSelf().inSingletonScope()
  bind(HttpChatApi).toSelf().inSingletonScope()
  bind(ScholarWorkspaceService).toSelf().inSingletonScope()
  bind(ScholarChatService).toSelf().inSingletonScope()
  bind(ScholarReadingSetService).toSelf().inSingletonScope()
  bind(ScholarAnnotationService).toSelf().inSingletonScope()
  bind(ScholarCitationService).toSelf().inSingletonScope()
  bind(ScholarSuggestionService).toSelf().inSingletonScope()
  bind(ScholarLlmSettingsService).toSelf().inSingletonScope()
  bindScholarGraphPropertyView(bind)

  // Intentionally NOT bound in singleton scope: Lumino widgets cannot be
  // "undisposed", so once the tab is closed the WidgetManager disposes this
  // instance. A singleton binding would keep returning that disposed
  // instance on next open. Using the default transient scope means each
  // `container.get()` call (triggered by the widget factory below) creates
  // a fresh widget, while `ScholarLlmSettingsService` (which is a singleton)
  // keeps the underlying state across reopens.
  bind(ScholarLlmSettingsWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_LLM_SETTINGS_WIDGET_ID,
    createWidget: () => context.container.get(ScholarLlmSettingsWidget),
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_LIBRARY_WIDGET_ID,
    createWidget: () => createTreeContainer(context.container, {
      props: {
        ...defaultTreeProps,
        contextMenuPath: SCHOLAR_LIBRARY_CONTEXT_MENU,
        search: true,
      },
      widget: ScholarLibraryWidget,
    }).get(ScholarLibraryWidget),
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_READING_SETS_WIDGET_ID,
    createWidget: () => createTreeContainer(context.container, {
      props: {
        ...defaultTreeProps,
        contextMenuPath: SCHOLAR_READING_SET_CONTEXT_MENU,
        expandOnlyOnExpansionToggleClick: true,
        search: true,
      },
      widget: ScholarReadingSetWidget,
    }).get(ScholarReadingSetWidget),
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_OUTLINE_WIDGET_ID,
    createWidget: () => createTreeContainer(context.container, {
      props: {
        ...defaultTreeProps,
        expandOnlyOnExpansionToggleClick: true,
        search: true,
      },
      widget: ScholarOutlineWidget,
    }).get(ScholarOutlineWidget),
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_NAVIGATION_WIDGET_ID,
    createWidget: async () => {
      const viewContainer = context.container.get<ViewContainer.Factory>(ViewContainer.Factory)({
        id: SCHOLAR_NAVIGATION_WIDGET_ID,
      })
      viewContainer.setTitleOptions({
        label: 'Navigate',
        caption: 'Paper Navigation',
        iconClass: 'codicon codicon-list-tree',
        closeable: true,
      })
      const widgetManager = context.container.get(WidgetManager)
      const outline = await widgetManager.getOrCreateWidget(SCHOLAR_OUTLINE_WIDGET_ID)
      viewContainer.addWidget(outline, { order: 10, weight: 1 })
      return viewContainer
    },
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_COMMENTS_WIDGET_ID,
    createWidget: () => createTreeContainer(context.container, {
      props: {
        ...defaultTreeProps,
        contextMenuPath: SCHOLAR_TREE_CONTEXT_MENU,
        expandOnlyOnExpansionToggleClick: true,
        search: true,
      },
      widget: ScholarCommentsWidget,
    }).get(ScholarCommentsWidget),
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_GLOSSARY_WIDGET_ID,
    createWidget: () => createTreeContainer(context.container, {
      props: {
        ...defaultTreeProps,
        contextMenuPath: SCHOLAR_TREE_CONTEXT_MENU,
        expandOnlyOnExpansionToggleClick: true,
        search: true,
      },
      widget: ScholarGlossaryWidget,
    }).get(ScholarGlossaryWidget),
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_SUGGESTIONS_WIDGET_ID,
    createWidget: () => createTreeContainer(context.container, {
      props: {
        ...defaultTreeProps,
        contextMenuPath: SCHOLAR_SUGGESTIONS_CONTEXT_MENU,
        expandOnlyOnExpansionToggleClick: true,
        search: true,
      },
      widget: ScholarSuggestionsTreeWidget,
    }).get(ScholarSuggestionsTreeWidget),
  })).inSingletonScope()

  // Transient for the same reason as the LLM settings widget: closing the tab
  // disposes the Lumino widget, so a singleton binding would hand a disposed
  // instance back to the widget factory on the next open.
  bind(ScholarSemanticLensWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_SEMANTIC_LENS_WIDGET_ID,
    createWidget: () => context.container.get(ScholarSemanticLensWidget),
  })).inSingletonScope()

  bind(ScholarChatWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_CHAT_WIDGET_ID,
    createWidget: () => context.container.get(ScholarChatWidget),
  })).inSingletonScope()

  bind(ScholarAnnotationEditorWidget).toSelf().inSingletonScope()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID,
    createWidget: () => context.container.get(ScholarAnnotationEditorWidget),
  })).inSingletonScope()

  bind(ScholarSuggestionEditorWidget).toSelf().inSingletonScope()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID,
    createWidget: () => context.container.get(ScholarSuggestionEditorWidget),
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_ANNOTATIONS_WIDGET_ID,
    createWidget: async () => {
      const viewContainer = context.container.get<ViewContainer.Factory>(ViewContainer.Factory)({
        id: SCHOLAR_ANNOTATIONS_WIDGET_ID,
      })
      viewContainer.setTitleOptions({
        label: 'Annotations',
        caption: 'Comments, Glossary, and Applied Annotations',
        iconClass: 'codicon codicon-comment-discussion',
        closeable: true,
      })
      const widgetManager = context.container.get(WidgetManager)
      const [comments, glossary, editor] = await Promise.all([
        widgetManager.getOrCreateWidget(SCHOLAR_COMMENTS_WIDGET_ID),
        widgetManager.getOrCreateWidget(SCHOLAR_GLOSSARY_WIDGET_ID),
        widgetManager.getOrCreateWidget(SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID),
      ])
      viewContainer.addWidget(comments, { order: 10, weight: 0.5 })
      viewContainer.addWidget(glossary, { order: 20, weight: 0.25, initiallyCollapsed: true })
      viewContainer.addWidget(editor, { order: 30, weight: 0.25, initiallyCollapsed: true })
      return viewContainer
    },
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID,
    createWidget: async () => {
      const viewContainer = context.container.get<ViewContainer.Factory>(ViewContainer.Factory)({
        id: SCHOLAR_TOOLTIP_DRAFTS_WIDGET_ID,
      })
      viewContainer.setTitleOptions({
        label: 'Term Highlights',
        caption: 'Manual and AI Term Highlights',
        iconClass: 'codicon codicon-lightbulb-sparkle',
        closeable: true,
      })
      const widgetManager = context.container.get(WidgetManager)
      const [suggestions, suggestionEditor] = await Promise.all([
        widgetManager.getOrCreateWidget(SCHOLAR_SUGGESTIONS_WIDGET_ID),
        widgetManager.getOrCreateWidget(SCHOLAR_SUGGESTION_EDITOR_WIDGET_ID),
      ])
      viewContainer.addWidget(suggestions, { order: 10, weight: 0.65 })
      viewContainer.addWidget(suggestionEditor, {
        order: 20,
        weight: 0.35,
        initiallyCollapsed: true,
      })
      return viewContainer
    },
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_PAPER_FACTORY_ID,
    createWidget: (options: unknown) => {
      if (!isScholarPaperWidgetOptions(options)) {
        throw new Error('A valid paperId and label are required to restore a paper widget')
      }
      return new ScholarPaperWidget(
        context.container.get(ScholarWorkspaceService),
        context.container.get(MessageService),
        context.container.get(ContextMenuRenderer),
        options,
        context.container.get(ScholarAnnotationService),
        context.container.get(SelectionService),
        context.container.get(ScholarChatService),
        context.container.get(ScholarCitationService),
      )
    },
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_PAPER_GRAPH_FACTORY_ID,
    createWidget: (options: unknown) => {
      if (!isScholarPaperGraphWidgetOptions(options)) {
        throw new Error('A valid paperId is required to restore a graph widget')
      }
      return new ScholarPaperGraphWidget(
        context.container.get(SelectionService),
        options,
      )
    },
  })).inSingletonScope()

  bind(ScholarContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ScholarContribution)
  bind(CommandContribution).toService(ScholarContribution)
  bind(MenuContribution).toService(ScholarContribution)
  bind(KeybindingContribution).toService(ScholarContribution)
  bind(TabBarToolbarContribution).toService(ScholarContribution)
})