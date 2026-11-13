export async function getDashboardSummary() {
  const response = await fetch('/api/v1/dashboard/summary', { credentials: 'include' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'Dashboard summary failed');
  return payload.data;
}
