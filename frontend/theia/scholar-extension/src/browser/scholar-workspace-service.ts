import { injectable } from '@theia/core/shared/inversify'

import { HttpReaderWorkspaceApi } from '../../../../lib/reader-workspace-api'
import { ReaderWorkspaceStore } from '../../../../lib/reader-workspace-store'

@injectable()
export class ScholarWorkspaceService extends ReaderWorkspaceStore {
  constructor() {
    super(new HttpReaderWorkspaceApi())
  }

  async initialize(): Promise<void> {
    await this.loadLibrary()
  }
}