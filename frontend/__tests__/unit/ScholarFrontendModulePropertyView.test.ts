import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readModuleSource(): string {
  const modulePath = path.resolve(
    process.cwd(),
    'theia/scholar-extension/src/browser/scholar-frontend-module.ts',
  )
  return fs.readFileSync(modulePath, 'utf-8')
}

describe('scholar-frontend-module wiring for the native Property View', () => {
  it('wires the Scholar graph PropertyDataService/PropertyViewWidgetProvider root contribution', () => {
    const source = readModuleSource()
    expect(source).toMatch(/bindScholarGraphPropertyView\(bind\)/)
  })

  it('does not bind a second PropertyViewContribution or duplicate the built-in toggle command', () => {
    const source = readModuleSource()
    expect(source).not.toContain('PropertyViewContribution')
    expect(source).not.toContain('property-view:toggle')
  })

  it('does not open/force-activate the Property View from module wiring', () => {
    const source = readModuleSource()
    expect(source).not.toMatch(/PropertyViewWidget\.ID/)
  })
})
