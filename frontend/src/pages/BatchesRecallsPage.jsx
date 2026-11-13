import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PERMISSION_CODES } from '../config/roles.js';
import { closeRecall, createBatch, getBatchesRecalls, issueRecall } from '../services/batchesRecalls.js';

const initialBatch = { productCode: '', batchCode: '', manufactureDate: '', expiryDate: '' };

export default function BatchesRecallsPage() {
  const { user } = useAuth();
  const permissions = user.permissions || [];
  const mayManageBatches = permissions.includes(PERMISSION_CODES.MANAGE_REGISTRATION);
  const mayManageRecalls = permissions.includes(PERMISSION_CODES.MANAGE_RECALLS);
  const mayApprove = permissions.includes(PERMISSION_CODES.APPROVE_REGULATORY_DECISIONS);
  const [data, setData] = useState({ batches: [], recalls: [] });
  const [batch, setBatch] = useState(initialBatch);
  const [recall, setRecall] = useState({ recallClass: 'I', reason: '', batchIds: [] });
  const [closeReason, setCloseReason] = useState('');
  const [selectedRecall, setSelectedRecall] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData(await getBatchesRecalls()); } catch (requestError) { setError(requestError.message); }
  }
  useEffect(() => { load(); }, []);
  function setBatchField(name, value) { setBatch((current) => ({ ...current, [name]: value })); }

  async function submitBatch(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await createBatch(batch); setBatch(initialBatch); setMessage('Batch recorded.'); await load(); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function submitRecall(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await issueRecall(recall); setRecall({ recallClass: 'I', reason: '', batchIds: [] }); setMessage('Recall issued.'); await load(); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function submitClose(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await closeRecall(selectedRecall.id, { reason: closeReason }); setSelectedRecall(null); setCloseReason(''); setMessage('Recall closed.'); await load(); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link className="text-sm font-semibold text-teal" to="/dashboard">← Dashboard</Link>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-teal">Product safety</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Batches and recalls</h1>
        <p className="mt-2 text-sm text-slate-600">Record medicine batches and keep recall status visible to authorised staff.</p>
        {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {mayManageBatches && <form className="rounded-2xl bg-white p-6 shadow-card" onSubmit={submitBatch}><h2 className="text-lg font-semibold text-ink">Record batch</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">
            {Object.entries({ productCode: 'Product code', batchCode: 'Batch code', manufactureDate: 'Manufacture date', expiryDate: 'Expiry date' }).map(([name, label]) => <label className="block text-sm font-semibold text-slate-700" key={name}>{label}<input className="field mt-2 block w-full" required={name !== 'manufactureDate'} type={name.includes('Date') ? 'date' : 'text'} value={batch[name]} onChange={(event) => setBatchField(name, event.target.value)} /></label>)}
          </div><button className="button-primary mt-6" disabled={busy} type="submit">Save batch</button></form>}
          {mayManageRecalls && <form className="rounded-2xl bg-white p-6 shadow-card" onSubmit={submitRecall}><h2 className="text-lg font-semibold text-ink">Issue recall</h2><label className="mt-4 block text-sm font-semibold text-slate-700">Recall class<select className="field mt-2 block w-full" value={recall.recallClass} onChange={(event) => setRecall({ ...recall, recallClass: event.target.value })}><option value="I">Class I — serious risk</option><option value="II">Class II — temporary risk</option><option value="III">Class III — low risk</option></select></label><label className="mt-4 block text-sm font-semibold text-slate-700">Affected batches<select className="field mt-2 block min-h-32 w-full" multiple required value={recall.batchIds} onChange={(event) => setRecall({ ...recall, batchIds: Array.from(event.target.selectedOptions, (option) => option.value) })}>{data.batches.map((row) => <option key={row.id} value={row.id}>{row.product_code} · {row.batch_code}</option>)}</select></label><label className="mt-4 block text-sm font-semibold text-slate-700">Reason<textarea className="field mt-2 block min-h-24 w-full" required value={recall.reason} onChange={(event) => setRecall({ ...recall, reason: event.target.value })} /></label><button className="button-primary mt-6" disabled={busy} type="submit">Issue recall</button></form>}
        </div>

        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-card"><h2 className="text-lg font-semibold text-ink">Batches</h2><div className="mt-4 space-y-3">{data.batches.map((row) => <div className="border-b border-slate-100 pb-3 text-sm" key={row.id}><p className="font-semibold">{row.product_code} · {row.batch_code}</p><p className="text-slate-500">{row.product_name} · expires {row.expiry_date}</p></div>)}{!data.batches.length && <p className="text-sm text-slate-500">No batches recorded.</p>}</div></div>
          <div className="rounded-2xl bg-white p-6 shadow-card"><h2 className="text-lg font-semibold text-ink">Recalls</h2><div className="mt-4 space-y-3">{data.recalls.map((row) => <div className="border-b border-slate-100 pb-3 text-sm" key={row.id}><div className="flex items-start justify-between gap-3"><p className="font-semibold">Class {row.recall_class} · {row.status}</p>{row.status === 'ACTIVE' && (mayManageRecalls || mayApprove) && <button className="button-secondary" type="button" onClick={() => setSelectedRecall(row)}>Close</button>}</div><p className="mt-1 text-slate-600">{row.reason}</p><p className="text-xs text-slate-500">Batches: {row.batch_codes || '—'}</p></div>)}{!data.recalls.length && <p className="text-sm text-slate-500">No recalls recorded.</p>}</div></div>
        </section>

        {selectedRecall && <form className="mt-6 rounded-2xl bg-white p-6 shadow-card" onSubmit={submitClose}><h2 className="text-lg font-semibold text-ink">Close Class {selectedRecall.recall_class} recall</h2><label className="mt-4 block text-sm font-semibold text-slate-700">Closure reason<textarea className="field mt-2 block min-h-24 w-full" required value={closeReason} onChange={(event) => setCloseReason(event.target.value)} /></label><button className="button-primary mt-4" disabled={busy} type="submit">Close recall</button></form>}
      </div>
    </main>
  );
}
