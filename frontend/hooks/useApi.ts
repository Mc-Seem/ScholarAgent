/**
 * API configuration and base fetch utilities
 */

// Browser calls should prefer the app's own /api rewrite unless explicitly overridden.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE?.trim() || "";

export interface ApiError {
  detail: string;
  status: number;
}

export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = API_BASE ? `${API_BASE}${endpoint}` : endpoint;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Request failed' }));
    throw {
      detail: error.detail || 'Request failed',
      status: response.status
    } as ApiError;
  }

  return response.json();
}
