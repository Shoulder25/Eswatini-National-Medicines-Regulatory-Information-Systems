async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/v1/pharmacovigilance${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Pharmacovigilance request failed');
  return payload.data;
}

export const getPharmacovigilanceReports = () => request('/');
export const submitPharmacovigilanceReport = (body) => request('/', { method: 'POST', body });
export const reviewPharmacovigilanceReport = (id, body) => request(`/${encodeURIComponent(id)}/review`, { method: 'POST', body });
