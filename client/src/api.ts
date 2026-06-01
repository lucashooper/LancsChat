const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

export async function api<T = unknown>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: unknown = {};
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid response from server (${res.status})`);
    }
  }

  if (!res.ok) {
    const errBody = data as Record<string, unknown>;
    const msg = typeof errBody.error === 'string' ? errBody.error : `Request failed (${res.status})`;
    console.error(`[API] ${method} ${endpoint} → ${res.status}:`, msg);
    throw new Error(msg);
  }

  return data as T;
}

export const API_BASE = API_URL;
export const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3001';
