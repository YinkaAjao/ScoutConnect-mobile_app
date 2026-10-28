// src/config.ts
export { API_BASE } from './constants/designSystem';
import { API_BASE } from './constants/designSystem';

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
    throw new Error(
      `Server returned HTML instead of JSON (Status ${response.status}) from ${url}. Check if Render is waking up or if the URL path is correct.`
    );
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}