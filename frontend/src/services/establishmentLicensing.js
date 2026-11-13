class EstablishmentLicensingApiError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/v1/establishment-licensing${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new EstablishmentLicensingApiError(payload?.error?.message || 'Establishment request failed', response.status, payload?.requestId);
  return payload?.data;
}

export const getEstablishmentApplications = () => request('/');
export const createEstablishmentApplication = (body) => request('/', { method: 'POST', body });
export const inspectEstablishment = (id, body) => request(`/${encodeURIComponent(id)}/inspect`, { method: 'POST', body });
export const decideEstablishment = (id, body) => request(`/${encodeURIComponent(id)}/decision`, { method: 'POST', body });
