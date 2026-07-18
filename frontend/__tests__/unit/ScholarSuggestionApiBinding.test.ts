import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8')
}

describe('native suggestion API dependency injection', () => {
  it('binds one HttpReaderWorkspaceApi instance in the root container', () => {
    const source = readSource(
      'theia/scholar-extension/src/browser/scholar-frontend-module.ts',
    )

    expect(source).toContain(
      'bind(HttpReaderWorkspaceApi).toSelf().inSingletonScope()',
    )
  })

  it('injects the shared adapter into ScholarWorkspaceService instead of constructing another one', () => {
    const source = readSource(
      'theia/scholar-extension/src/browser/scholar-workspace-service.ts',
    )

    expect(source).toMatch(/constructor\(\s*@inject\(HttpReaderWorkspaceApi\)\s+api: HttpReaderWorkspaceApi/)
    expect(source).toContain('super(api)')
    expect(source).not.toContain('new HttpReaderWorkspaceApi()')
  })
})