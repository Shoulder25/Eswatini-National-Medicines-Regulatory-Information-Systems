class InvitationApiError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.name = 'InvitationApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api/v1/admin-invitations${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new InvitationApiError('Could not reach eNMRIS. Check that the API is running and try again.', 0);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new InvitationApiError('The server returned an unexpected response.', response.status);
  }

  if (!response.ok) {
    throw new InvitationApiError(
      payload?.error?.message || 'The request could not be completed.',
      response.status,
      payload?.requestId,
    );
  }

  return payload?.data;
}

export function getAdminInvitations() {
  return request('/');
}

export function createAdminInvitation({ name, email }) {
  return request('/', { method: 'POST', body: { name, email } });
}

export function decideAdminInvitation(id, { decision, reason, totpCode }) {
  return request(`/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    body: { decision, reason, totpCode },
  });
}

export function reissueAdminSetupLink(id, { reason, totpCode }) {
  return request(`/${encodeURIComponent(id)}/reissue`, {
    method: 'POST',
    body: { reason, totpCode },
  });
}

export function inspectAdminSetupToken(token) {
  return request('/setup/inspect', { method: 'POST', body: { token } });
}

export function completeAdminSetup({ token, password, totpSecret, totpCode }) {
  return request('/setup/complete', {
    method: 'POST',
    body: { token, password, totpSecret, totpCode },
  });
}
