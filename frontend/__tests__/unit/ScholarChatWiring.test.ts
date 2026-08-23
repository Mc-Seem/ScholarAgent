import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(file: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), file), 'utf-8')
}

describe('Theia chat wiring', () => {
  it('binds the API/service and a restorable transient widget factory', () => {
    const module = source('theia/scholar-extension/src/browser/scholar-frontend-module.ts')
    expect(module).toContain('bind(HttpChatApi).toSelf().inSingletonScope()')
    expect(module).toContain('bind(ScholarChatService).toSelf().inSingletonScope()')
    expect(module).toContain('bind(ScholarChatWidget).toSelf()')
    expect(module).toMatch(/id: SCHOLAR_CHAT_WIDGET_ID,[\s\S]*get\(ScholarChatWidget\)/)
  })

  it('registers an open command and places Chat in the right area', () => {
    const commands = source('theia/scholar-extension/src/browser/scholar-commands.ts')
    const contribution = source('theia/scholar-extension/src/browser/scholar-contribution.ts')
    expect(commands).toContain('SHOW_CHAT')
    expect(contribution).toMatch(/SHOW_CHAT[\s\S]*showView\(SCHOLAR_CHAT_WIDGET_ID, 'right'\)/)
    expect(contribution).toMatch(/getOrCreateWidget\(SCHOLAR_CHAT_WIDGET_ID\)[\s\S]*area: 'right'/)
  })
})
