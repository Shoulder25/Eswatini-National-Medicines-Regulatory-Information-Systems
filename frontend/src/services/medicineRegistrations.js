class MedicineRegistrationApiError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api/v1/medicine-registrations${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new MedicineRegistrationApiError(
      payload?.error?.message || 'Medicine registration request failed',
      response.status,
      payload?.requestId,
    );
  }
  return payload?.data;
}

export const getMedicineRegistrations = () => request('/');
export const createMedicineRegistration = (body) => request('/', { method: 'POST', body });
export const evaluateMedicineRegistration = (id, body) => request(`/${encodeURIComponent(id)}/evaluate`, { method: 'POST', body });
export const decideMedicineRegistration = (id, body) => request(`/${encodeURIComponent(id)}/decision`, { method: 'POST', body });
