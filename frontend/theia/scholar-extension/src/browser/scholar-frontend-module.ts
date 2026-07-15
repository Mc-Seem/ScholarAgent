import { MessageService } from '@theia/core'
import {
  CommandContribution,
  MenuContribution,
} from '@theia/core/lib/common'
import {
  FrontendApplicationContribution,
  KeybindingContribution,
  WidgetFactory,
} from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'

import { ScholarContribution } from './scholar-contribution'
import {
  SCHOLAR_ANNOTATIONS_WIDGET_ID,
  SCHOLAR_LIBRARY_WIDGET_ID,
  SCHOLAR_NAVIGATION_WIDGET_ID,
  ScholarAnnotationsWidget,
  ScholarLibraryWidget,
  ScholarNavigationWidget,
} from './scholar-side-widgets'
import {
  SCHOLAR_PAPER_FACTORY_ID,
  ScholarPaperWidget,
  isScholarPaperWidgetOptions,
} from './scholar-paper-widget'
import { ScholarWorkspaceService } from './scholar-workspace-service'
import './style/generated.css'

export default new ContainerModule(bind => {
  bind(ScholarWorkspaceService).toSelf().inSingletonScope()

  bind(ScholarLibraryWidget).toSelf().inSingletonScope()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_LIBRARY_WIDGET_ID,
    createWidget: () => context.container.get(ScholarLibraryWidget),
  })).inSingletonScope()

  bind(ScholarNavigationWidget).toSelf().inSingletonScope()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_NAVIGATION_WIDGET_ID,
    createWidget: () => context.container.get(ScholarNavigationWidget),
  })).inSingletonScope()

  bind(ScholarAnnotationsWidget).toSelf().inSingletonScope()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: SCHOLAR_ANNOTATIONS_WIDGET_ID,
    createWidget: () => context.container.get(ScholarAnnotationsWidget),
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
        options,
      )
    },
  })).inSingletonScope()

  bind(ScholarContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution).toService(ScholarContribution)
  bind(CommandContribution).toService(ScholarContribution)
  bind(MenuContribution).toService(ScholarContribution)
  bind(KeybindingContribution).toService(ScholarContribution)
})