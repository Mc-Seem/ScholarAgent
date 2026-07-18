import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const THEIA_VERSION = '1.73.0'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

interface PackageLockPackageEntry {
  version?: string
}

interface PackageLock {
  packages?: Record<string, PackageLockPackageEntry>
}

function readJson<T>(relativePath: string): T {
  const fullPath = path.resolve(process.cwd(), relativePath)
  return JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as T
}

describe('@theia/property-view packaging', () => {
  it('pins the exact installed version in the extension, browser-app and electron-app manifests', () => {
    const extensionPkg = readJson<PackageJson>('theia/scholar-extension/package.json')
    const browserPkg = readJson<PackageJson>('theia/browser-app/package.json')
    const electronPkg = readJson<PackageJson>('theia/electron-app/package.json')

    expect(extensionPkg.dependencies?.['@theia/property-view']).toBe(THEIA_VERSION)
    expect(browserPkg.dependencies?.['@theia/property-view']).toBe(THEIA_VERSION)
    expect(electronPkg.dependencies?.['@theia/property-view']).toBe(THEIA_VERSION)
  })

  it('matches the already-pinned @theia/core version (no accidental version drift)', () => {
    const extensionPkg = readJson<PackageJson>('theia/scholar-extension/package.json')
    const browserPkg = readJson<PackageJson>('theia/browser-app/package.json')
    const electronPkg = readJson<PackageJson>('theia/electron-app/package.json')

    expect(extensionPkg.dependencies?.['@theia/core']).toBe(THEIA_VERSION)
    expect(browserPkg.dependencies?.['@theia/core']).toBe(THEIA_VERSION)
    expect(electronPkg.dependencies?.['@theia/core']).toBe(THEIA_VERSION)
  })

  it('is present and resolved to the pinned version in the root package-lock.json', () => {
    const lock = readJson<PackageLock>('package-lock.json')
    const entry = lock.packages?.['node_modules/@theia/property-view']
    expect(entry).toBeDefined()
    expect(entry?.version).toBe(THEIA_VERSION)
  })

  it('resolves to a single, non-conflicting version across every workspace in the lockfile', () => {
    const lock = readJson<PackageLock>('package-lock.json')
    const versions = new Set<string>()
    for (const [key, value] of Object.entries(lock.packages ?? {})) {
      if (key.endsWith('node_modules/@theia/property-view') && value.version) {
        versions.add(value.version)
      }
    }
    expect(versions).toEqual(new Set([THEIA_VERSION]))
  })
})
