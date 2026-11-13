import { useState } from 'react';
import { Link } from 'react-router-dom';

export default function PublicRegistryPage() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`/api/v1/registry-search/public?q=${encodeURIComponent(query)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || 'Public search failed');
      setRows(payload.data);
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">eNMRIS public register</p><h1 className="mt-2 text-3xl font-semibold text-ink">Check a registered medicine</h1></div>
          <Link className="text-sm font-semibold text-teal" to="/login">Staff sign in</Link>
        </div>
        <p className="mt-3 text-sm text-slate-600">Search approved medicines and see whether any recorded batch has an active recall.</p>
        <form className="mt-6 flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-card sm:flex-row" onSubmit={submit}>
          <input className="field flex-1" aria-label="Public medicine search" placeholder="Product name, code, registration, or batch" value={query} onChange={(event) => setQuery(event.target.value)} />
          <button className="button-primary" disabled={busy || !query.trim()} type="submit">{busy ? 'Searching…' : 'Search register'}</button>
        </form>
        {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          {rows.map((row) => <article className="rounded-2xl bg-white p-5 shadow-card" key={`${row.product_code}-${row.batch_code || 'product'}`}><div className="flex items-start justify-between gap-3"><h2 className="font-semibold text-ink">{row.product_name}</h2><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Registered</span></div><p className="mt-2 text-sm text-slate-600">Product code: {row.product_code}</p><p className="text-sm text-slate-600">Registration: {row.registration_number}</p>{row.batch_code && <p className="mt-3 text-sm text-slate-600">Batch {row.batch_code} · expires {row.batch_expiry_date || 'not recorded'}</p>}{row.active_recalls && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">Active recall: {row.active_recalls}</p>}</article>)}
          {!rows.length && <p className="col-span-full rounded-2xl bg-white px-5 py-10 text-center text-sm text-slate-500">Enter a search term to check the public register.</p>}
        </section>
      </div>
    </main>
  );
}
