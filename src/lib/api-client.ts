'use client';

import { fetchAuthSession } from 'aws-amplify/auth';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export class ApiClientError extends Error {
  statusCode: number;
  suggestion?: string;

  constructor(statusCode: number, message: string, suggestion?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.suggestion = suggestion;
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();

  if (!token) {
    throw new ApiClientError(401, 'Not authenticated. Please log in.');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    const message = errData?.message || `Request failed with status ${res.status}`;
    const suggestion = errData?.suggestion;
    throw new ApiClientError(res.status, message, suggestion);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// API Methods
// ─────────────────────────────────────────────────────────────────────────────

export async function apiGet<T = unknown>(url: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'GET',
    headers,
  });
  return handleResponse<T>(res);
}

export async function apiPost<T = unknown>(url: string, body?: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiPut<T = unknown>(url: string, body?: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'PUT',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse<T>(res);
}

export async function apiDelete<T = unknown>(url: string): Promise<T> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${url}`, {
    method: 'DELETE',
    headers,
  });
  return handleResponse<T>(res);
}

// ─────────────────────────────────────────────────────────────────────────────
// SWR Fetcher
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SWR-compatible fetcher that injects auth headers.
 * Usage: useSWR('/assessments', swrFetcher)
 */
export async function swrFetcher<T = unknown>(url: string): Promise<T> {
  return apiGet<T>(url);
}
