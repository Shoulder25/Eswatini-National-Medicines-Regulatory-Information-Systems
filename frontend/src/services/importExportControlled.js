class ImportExportControlledApiError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/v1/import-export-controlled${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new ImportExportControlledApiError(payload?.error?.message || 'Permit request failed', response.status, payload?.requestId);
  return payload?.data;
}

export const getControlledPermits = () => request('/');
export const createControlledPermit = (body) => request('/', { method: 'POST', body });
export const verifyControlledPermit = (id, body) => request(`/${encodeURIComponent(id)}/verify`, { method: 'POST', body });
export const decideControlledPermit = (id, body) => request(`/${encodeURIComponent(id)}/decision`, { method: 'POST', body });
