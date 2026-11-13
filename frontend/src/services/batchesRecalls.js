async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/v1/batches-recalls${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Batch or recall request failed');
  return payload.data;
}

export const getBatchesRecalls = () => request('/');
export const createBatch = (body) => request('/batches', { method: 'POST', body });
export const issueRecall = (body) => request('/recalls', { method: 'POST', body });
export const closeRecall = (id, body) => request(`/recalls/${encodeURIComponent(id)}/close`, { method: 'POST', body });
