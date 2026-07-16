import { MessageService } from '@theia/core'
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

import { ScholarContribution } from './scholar-contribution'
import {
  SCHOLAR_ANNOTATIONS_WIDGET_ID,
  SCHOLAR_LIBRARY_WIDGET_ID,
  SCHOLAR_NAVIGATION_WIDGET_ID,
  ScholarLibraryWidget,
} from './scholar-side-widgets'
import { ScholarAnnotationService } from './scholar-annotation-service'
import {
  SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID,
  SCHOLAR_COMMENTS_WIDGET_ID,
  SCHOLAR_GLOSSARY_WIDGET_ID,
  SCHOLAR_GRAPH_WIDGET_ID,
  SCHOLAR_OUTLINE_WIDGET_ID,
  SCHOLAR_TREE_CONTEXT_MENU,
  ScholarAnnotationEditorWidget,
  ScholarCommentsWidget,
  ScholarGlossaryWidget,
  ScholarGraphWidget,
  ScholarOutlineWidget,
} from './scholar-native-widgets'
import {
  SCHOLAR_PAPER_FACTORY_ID,
  ScholarPaperWidget,
  isScholarPaperWidgetOptions,
} from './scholar-paper-widget'
import { ScholarWorkspaceService } from './scholar-workspace-service'
import './style/generated.css'

export default new ContainerModule(bind => {
  bind(ScholarWorkspaceService).toSelf().inSingletonScope()
  bind(ScholarAnnotationService).toSelf().inSingletonScope()

  bind(ScholarLibraryWidget).toSelf().inSingletonScope()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_LIBRARY_WIDGET_ID,
    createWidget: () => context.container.get(ScholarLibraryWidget),
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

  bind(ScholarGraphWidget).toSelf().inSingletonScope()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_GRAPH_WIDGET_ID,
    createWidget: () => context.container.get(ScholarGraphWidget),
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
      const [outline, graph] = await Promise.all([
        widgetManager.getOrCreateWidget(SCHOLAR_OUTLINE_WIDGET_ID),
        widgetManager.getOrCreateWidget(SCHOLAR_GRAPH_WIDGET_ID),
      ])
      viewContainer.addWidget(outline, { order: 10, weight: 0.4 })
      viewContainer.addWidget(graph, { order: 20, weight: 0.6, initiallyCollapsed: true })
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

  bind(ScholarAnnotationEditorWidget).toSelf().inSingletonScope()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_ANNOTATION_EDITOR_WIDGET_ID,
    createWidget: () => context.container.get(ScholarAnnotationEditorWidget),
  })).inSingletonScope()

  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_ANNOTATIONS_WIDGET_ID,
    createWidget: async () => {
      const viewContainer = context.container.get<ViewContainer.Factory>(ViewContainer.Factory)({
        id: SCHOLAR_ANNOTATIONS_WIDGET_ID,
      })
      viewContainer.setTitleOptions({
        label: 'Annotations',
        caption: 'Comments and Glossary',
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