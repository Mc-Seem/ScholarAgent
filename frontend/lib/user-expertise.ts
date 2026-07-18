export const USER_EXPERTISE_STORAGE_KEY = 'scholar-agent-expertise'

export const DEFAULT_USER_EXPERTISE = 'I have a general STEM background with basic understanding of mathematical notation and common scientific concepts.'

export interface UserExpertiseStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readUserExpertise(
  storage: UserExpertiseStorage = localStorage,
): string {
  return storage.getItem(USER_EXPERTISE_STORAGE_KEY) || DEFAULT_USER_EXPERTISE
}

export function writeUserExpertise(
  expertise: string,
  storage: UserExpertiseStorage = localStorage,
): void {
  storage.setItem(USER_EXPERTISE_STORAGE_KEY, expertise)
}