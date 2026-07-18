import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_USER_EXPERTISE,
  USER_EXPERTISE_STORAGE_KEY,
  readUserExpertise,
  writeUserExpertise,
} from '@/lib/user-expertise'

function createStorage(value: string | null) {
  return {
    getItem: vi.fn().mockReturnValue(value),
    setItem: vi.fn(),
  }
}

describe('user expertise settings', () => {
  it('keeps the legacy storage key and default text', () => {
    expect(USER_EXPERTISE_STORAGE_KEY).toBe('scholar-agent-expertise')
    expect(DEFAULT_USER_EXPERTISE).toBe(
      'I have a general STEM background with basic understanding of mathematical notation and common scientific concepts.',
    )
  })

  it('reads a saved expertise without rewriting storage', () => {
    const storage = createStorage('Category theory researcher')

    expect(readUserExpertise(storage)).toBe('Category theory researcher')
    expect(storage.getItem).toHaveBeenCalledWith(USER_EXPERTISE_STORAGE_KEY)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('falls back for missing or empty storage without persisting the default', () => {
    const missingStorage = createStorage(null)
    const emptyStorage = createStorage('')

    expect(readUserExpertise(missingStorage)).toBe(DEFAULT_USER_EXPERTISE)
    expect(readUserExpertise(emptyStorage)).toBe(DEFAULT_USER_EXPERTISE)
    expect(missingStorage.setItem).not.toHaveBeenCalled()
    expect(emptyStorage.setItem).not.toHaveBeenCalled()
  })

  it('preserves a truthy stored value exactly, matching the legacy reader', () => {
    const storage = createStorage('  ')

    expect(readUserExpertise(storage)).toBe('  ')
  })

  it('writes the confirmed expertise under the shared key', () => {
    const storage = createStorage(null)

    writeUserExpertise('Numerical analysis researcher', storage)

    expect(storage.setItem).toHaveBeenCalledWith(
      USER_EXPERTISE_STORAGE_KEY,
      'Numerical analysis researcher',
    )
  })
})