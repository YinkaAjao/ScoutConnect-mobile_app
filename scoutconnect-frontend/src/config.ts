// src/config.ts
export { API_BASE } from './constants/designSystem';
import { API_BASE } from './constants/designSystem';
import { friendlyStatusMessage } from './lib/api';

/**
 * Safe fetch wrapper that prevents JSON Parse crashes ('<' HTML errors)
 * when Render is waking up or a route 404s.
 */
export async function safeFetchJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    console.warn(`Non-JSON response (status ${response.status}) from ${url}`);
    throw new Error('The server is not responding properly. It may be waking up, so please try again in a moment.');
  }

  if (!response.ok) {
    throw new Error(data?.error || friendlyStatusMessage(response.status));
  }

  return data;
}