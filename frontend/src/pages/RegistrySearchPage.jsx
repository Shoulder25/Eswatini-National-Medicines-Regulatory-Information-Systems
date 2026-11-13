import { useState } from 'react';
import { Link } from 'react-router-dom';
import { searchRegistry } from '../services/registrySearch.js';

export default function RegistrySearchPage() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { setRows(await searchRegistry(query)); } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link className="text-sm font-semibold text-teal" to="/dashboard">← Dashboard</Link>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-teal">National medicines register</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Search medicines and batches</h1>
        <p className="mt-2 text-sm text-slate-600">Search by product code, medicine name, registration number, or batch code.</p>
        <form className="mt-6 flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-card sm:flex-row" onSubmit={submit}>
          <input className="field flex-1" aria-label="Search registry" placeholder="Enter a product, registration, or batch code" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="button-primary" disabled={busy || !query.trim()} type="submit">{busy ? 'Searching…' : 'Search'}</button>
        </form>
        {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <div className="mt-6 overflow-hidden rounded-2xl bg-white shadow-card">
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Medicine</th><th className="px-5 py-3">Registration</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Batch</th><th className="px-5 py-3">Recall</th></tr></thead><tbody className="divide-y divide-slate-100">
            {rows.map((row) => <tr key={`${row.product_id}-${row.batch_id || 'product'}`}><td className="px-5 py-4"><p className="font-semibold text-ink">{row.product_name}</p><p className="text-xs text-slate-500">{row.product_code}</p></td><td className="px-5 py-4">{row.registration_number || '—'}<span className="block text-xs text-slate-500">{row.holder_name || ''}</span></td><td className="px-5 py-4">{row.registration_status || 'UNREGISTERED'}</td><td className="px-5 py-4">{row.batch_code || '—'}<span className="block text-xs text-slate-500">{row.batch_expiry_date || ''}</span></td><td className="px-5 py-4">{row.recalls || 'None'}</td></tr>)}
            {!rows.length && <tr><td className="px-5 py-10 text-center text-slate-500" colSpan="5">Search results will appear here.</td></tr>}
          </tbody></table></div>
        </div>
      </div>
    </main>
  );
}
