import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createApiClient, getApiClients, revokeApiClient } from '../services/apiClients.js';

export default function ApiClientsPage() {
  const [rows, setRows] = useState([]);
  const [displayName, setDisplayName] = useState('');
  const [createdToken, setCreatedToken] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() { try { setRows(await getApiClients()); } catch (requestError) { setError(requestError.message); } }
  useEffect(() => { load(); }, []);
  async function create(event) {
    event.preventDefault(); setBusy(true); setError(''); setCreatedToken('');
    try { const result = await createApiClient({ displayName, scopes: ['registry:read', 'fhir:read'] }); setDisplayName(''); setCreatedToken(result.accessToken); setMessage(`Client ${result.clientId} created. Copy the token now; it will not be shown again.`); await load(); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function revoke(id) {
    setBusy(true); setError('');
    try { await revokeApiClient(id); setMessage('API client revoked.'); await load(); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8"><div className="mx-auto max-w-6xl">
      <Link className="text-sm font-semibold text-teal" to="/dashboard">← Dashboard</Link>
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-teal">System integration</p><h1 className="mt-2 text-3xl font-semibold text-ink">Scoped API access</h1>
      <p className="mt-2 text-sm text-slate-600">Create read-only credentials for authorised registry and FHIR integrations. Store each token securely when it is created.</p>
      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}{message && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}
      {createdToken && <div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">New access token — copy it now</p><code className="mt-2 block break-all rounded bg-white p-3">{createdToken}</code></div>}
      <form className="mt-6 flex flex-col gap-3 rounded-2xl bg-white p-6 shadow-card sm:flex-row sm:items-end" onSubmit={create}><label className="block flex-1 text-sm font-semibold text-slate-700">Integration name<input className="field mt-2 block w-full" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><button className="button-primary" disabled={busy} type="submit">Create access token</button></form>
      <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-card"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Integration</th><th className="px-5 py-3">Client ID</th><th className="px-5 py-3">Scopes</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="px-5 py-4 font-semibold">{row.display_name}</td><td className="px-5 py-4">{row.client_id}</td><td className="px-5 py-4">{row.scopes || '—'}</td><td className="px-5 py-4">{row.revoked_at ? 'Revoked' : row.active ? 'Active' : 'Inactive'}</td><td className="px-5 py-4">{!row.revoked_at && <button className="button-secondary" disabled={busy} onClick={() => revoke(row.id)} type="button">Revoke</button>}</td></tr>)}{!rows.length && <tr><td className="px-5 py-8 text-center text-slate-500" colSpan="5">No API clients configured.</td></tr>}</tbody></table></div></section>
    </div></main>
  );
}
