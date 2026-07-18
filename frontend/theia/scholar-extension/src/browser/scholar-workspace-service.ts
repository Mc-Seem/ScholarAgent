import { inject, injectable } from '@theia/core/shared/inversify'

import { HttpReaderWorkspaceApi } from '../../../../lib/reader-workspace-api'
import { ReaderWorkspaceStore } from '../../../../lib/reader-workspace-store'

@injectable()
export class ScholarWorkspaceService extends ReaderWorkspaceStore {
  constructor(
    @inject(HttpReaderWorkspaceApi) api: HttpReaderWorkspaceApi,
  ) {
    super(api)
  }

  async initialize(): Promise<void> {
    await this.loadLibrary()
  }
}