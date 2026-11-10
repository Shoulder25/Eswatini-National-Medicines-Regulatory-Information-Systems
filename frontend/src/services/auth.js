class AuthApiError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.name = 'AuthApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api/v1/auth${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AuthApiError('Could not reach eNMRIS. Check that the API is running and try again.', 0);
  }

  let payload = null;
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      throw new AuthApiError('The server returned an unexpected response.', response.status);
    }
  }

  if (!response.ok) {
    throw new AuthApiError(
      payload?.error?.message || 'The request could not be completed.',
      response.status,
      payload?.requestId,
    );
  }

  return payload?.data;
}

export function login({ email, password, totpCode }) {
  return request('/login', {
    method: 'POST',
    body: { email, password, totpCode },
  });
}

export function completeOfficerMfaEnrollment({ enrollmentToken, totpSecret, totpCode }) {
  return request('/mfa/enrollment/complete', {
    method: 'POST',
    body: { enrollmentToken, totpSecret, totpCode },
  });
}

export function getCurrentUser() {
  return request('/me');
}

export function logout() {
  return request('/logout', { method: 'POST' });
}
