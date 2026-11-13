class RecoveryApiError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/v1/account-recovery${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new RecoveryApiError(payload?.error?.message || 'Recovery request failed', response.status, payload?.requestId);
  return payload?.data;
}

export const getRecoveryRequests = () => request('/');
export const createRecoveryRequest = (body) => request('/', { method: 'POST', body });
export const approveRecoveryRequest = (id, body) => request(`/${encodeURIComponent(id)}/approve`, { method: 'POST', body });
export const inspectRecoveryToken = (token) => request('/setup/inspect', { method: 'POST', body: { token } });
export const completeRecovery = (body) => request('/setup/complete', { method: 'POST', body });
