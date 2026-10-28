// src/lib/api.ts
import { getAuthToken } from './supabase';
import { API_BASE } from '../constants/designSystem';

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: any;
  constructor(message: string, status: number, code?: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Attach the Supabase access token (default true). */
  auth?: boolean;
  /** Per-attempt timeout; a sleeping Render instance can take ~30s to wake. */
  timeoutMs?: number;
  /** Extra attempts after a timeout, network error or gateway error. */
  retries?: number;
  /** Called before a retry so the UI can say the server is waking up. */
  onRetry?: (attempt: number) => void;
}

// 502/503/504 and Cloudflare's 522/523/524 are what a cold or restarting Render instance returns.
const RETRYABLE_STATUS = new Set([502, 503, 504, 522, 523, 524]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * JSON request to the ScoutConnect API with auth, a timeout and retry for cold starts.
 * Throws ApiError for non-2xx responses, using the server's `error` message when present.
 */
export async function apiFetch<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, timeoutMs = 40000, retries = 2, onRetry } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await getAuthToken();
    if (!token) throw new ApiError('Your session has expired. Please sign in again.', 401, 'NO_SESSION');
    headers['Authorization'] = `Bearer ${token}`;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      onRetry?.(attempt);
      await sleep(2000 * attempt);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // Non-JSON body (e.g. a Cloudflare HTML error page); handled by status below.
      }

      if (response.ok) return data as T;
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        lastError = new ApiError('The server is waking up. Please wait…', response.status);
        continue;
      }
      throw new ApiError(
        data?.error || (RETRYABLE_STATUS.has(response.status) ? 'The server is not responding. Please try again shortly.' : `Request failed (${response.status})`),
        response.status,
        data?.code,
        data
      );
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      // Timeout (AbortError) or network failure: retry, then give a readable message.
      lastError = error;
      if (attempt === retries) {
        const timedOut = error?.name === 'AbortError';
        throw new ApiError(
          timedOut ? 'The server took too long to respond. Please try again.' : 'Network error. Please check your internet connection.',
          0,
          timedOut ? 'TIMEOUT' : 'NETWORK'
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new ApiError('Request failed.', 0);
}
