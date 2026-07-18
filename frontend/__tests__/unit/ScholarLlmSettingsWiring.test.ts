import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'


function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf-8')
}

describe('native LLM Settings wiring', () => {
  it('binds one shared adapter, service, widget, and stable restorable factory', () => {
    const source = readSource(
      'theia/scholar-extension/src/browser/scholar-frontend-module.ts',
    )

    expect(source).toContain('bind(HttpLlmSettingsApi).toSelf().inSingletonScope()')
    expect(source).toContain('bind(ScholarLlmSettingsService).toSelf().inSingletonScope()')
    expect(source).toContain('bind(ScholarLlmSettingsWidget).toSelf().inSingletonScope()')
    expect(source).toMatch(
      /id: SCHOLAR_LLM_SETTINGS_WIDGET_ID,[\s\S]*createWidget: \(\) => context\.container\.get\(ScholarLlmSettingsWidget\)/,
    )
  })

  it('opens one central settings tab and exposes it from both native settings menus', () => {
    const source = readSource(
      'theia/scholar-extension/src/browser/scholar-contribution.ts',
    )

    expect(source).toMatch(
      /OPEN_LLM_SETTINGS[\s\S]*getOrCreateWidget\(SCHOLAR_LLM_SETTINGS_WIDGET_ID\)[\s\S]*area: 'main'/,
    )
    expect(source).toMatch(
      /registerMenuAction\(CommonMenus\.FILE_SETTINGS_SUBMENU_OPEN,[\s\S]*OPEN_LLM_SETTINGS/,
    )
    expect(source).toMatch(
      /registerMenuAction\(CommonMenus\.MANAGE_SETTINGS,[\s\S]*OPEN_LLM_SETTINGS/,
    )
  })

  it('uses Saveable for native File Save instead of duplicating settings Save/Revert there', () => {
    const source = readSource(
      'theia/scholar-extension/src/browser/scholar-contribution.ts',
    )

    expect(source).not.toMatch(
      /registerMenuAction\(CommonMenus\.FILE_SAVE,[\s\S]*SAVE_LLM_SETTINGS/,
    )
    expect(source).not.toMatch(
      /registerMenuAction\(CommonMenus\.FILE_SAVE,[\s\S]*REVERT_LLM_SETTINGS/,
    )
  })

  it('keeps command arguments and layout state free of connection drafts and plaintext secrets', () => {
    const commands = readSource(
      'theia/scholar-extension/src/browser/scholar-commands.ts',
    )
    const widget = readSource(
      'theia/scholar-extension/src/browser/scholar-llm-settings-widget.tsx',
    )

    expect(commands).not.toContain('apiKey')
    expect(commands).not.toContain('baseUrl')
    expect(widget).not.toContain('storeState(')
    expect(widget).not.toContain('restoreState(')
  })
})