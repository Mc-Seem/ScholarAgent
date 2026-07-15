/**
 * API configuration and base fetch utilities
 */

declare global {
  interface Window {
    __SCHOLAR_API_BASE__?: string;
  }
}

export function resolveApiBase(): string {
  const runtimeBase = typeof window !== 'undefined'
    ? window.__SCHOLAR_API_BASE__
    : undefined;
  const environmentBase = typeof process !== 'undefined'
    ? process.env.NEXT_PUBLIC_API_BASE
    : undefined;
  const hostname = typeof window !== 'undefined' && window.location.hostname
    ? window.location.hostname
    : 'localhost';

  return (runtimeBase || environmentBase || `http://${hostname}:8000`).replace(/\/$/, '');
}

export const API_BASE = resolveApiBase();

export function apiUrl(endpoint: string, apiBase = API_BASE): string {
  return `${apiBase}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
}

export interface ApiError {
  detail: string;
  status: number;
}

export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = apiUrl(endpoint);

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
