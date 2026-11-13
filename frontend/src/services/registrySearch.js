async function request(path) {
  const response = await fetch(`/api/v1/registry-search${path}`, { credentials: 'include' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Registry search failed');
  return payload;
}

export const searchRegistry = async (query) => (await request(`/?q=${encodeURIComponent(query)}`)).data;
export const getMedicationBundle = (query) => request(`/fhir/Medication?name=${encodeURIComponent(query)}`);
