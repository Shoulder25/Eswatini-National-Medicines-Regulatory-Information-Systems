class OfficerReplacementApiError extends Error {
  constructor(message, status, requestId) {
    super(message);
    this.name = 'OfficerReplacementApiError';
    this.status = status;
    this.requestId = requestId;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api/v1/officer-replacements${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new OfficerReplacementApiError('Could not reach eNMRIS. Check that the API is running and try again.', 0);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new OfficerReplacementApiError('The server returned an unexpected response.', response.status);
  }
  if (!response.ok) {
    throw new OfficerReplacementApiError(
      payload?.error?.message || 'The request could not be completed.',
      response.status,
      payload?.requestId,
    );
  }
  return payload?.data;
}

export function getOfficerReplacementRequests() {
  return request('/');
}

export function createOfficerReplacement({ outgoingPosition, incomingName, incomingEmail }) {
  return request('/', {
    method: 'POST',
    body: { outgoingPosition, incomingName, incomingEmail },
  });
}

export function decideOfficerReplacement(id, { decision, reason, totpCode }) {
  return request(`/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    body: { decision, reason, totpCode },
  });
}

export function reissueOfficerSetupLink(id, { reason, totpCode }) {
  return request(`/${encodeURIComponent(id)}/reissue`, {
    method: 'POST',
    body: { reason, totpCode },
  });
}

export function inspectOfficerSetupToken(token) {
  return request('/setup/inspect', { method: 'POST', body: { token } });
}

export function completeOfficerSetup({ token, password, totpCode }) {
  return request('/setup/complete', {
    method: 'POST',
    body: { token, password, totpCode },
  });
}
