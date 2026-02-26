const API_URL = 'http://localhost:3001/api';

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

export async function api(endpoint: string, options: RequestOptions = {}) {
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

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Something went wrong');
  }

  return data;
}

export const API_BASE = API_URL;
export const WS_URL = 'http://localhost:3001';
