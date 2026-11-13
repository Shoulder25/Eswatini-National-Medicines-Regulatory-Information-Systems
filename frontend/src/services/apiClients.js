async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/v1/api-clients${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'API client request failed');
  return payload.data;
}

export const getApiClients = () => request('/');
export const createApiClient = (body) => request('/', { method: 'POST', body });
export const revokeApiClient = (id) => request(`/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {} });
