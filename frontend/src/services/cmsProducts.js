export async function importCmsProducts(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch('/api/v1/cms-products/import', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'CMS import failed');
  return payload.data;
}

export async function downloadCmsProducts() {
  const response = await fetch('/api/v1/cms-products/export', { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload?.error?.message || 'CMS export failed');
  }
  return response.blob();
}
