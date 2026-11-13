import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { approveRecoveryRequest, createRecoveryRequest, getRecoveryRequests } from '../services/accountRecovery.js';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function AccountRecoveryPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [totp, setTotp] = useState('');
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setRows(await getRecoveryRequests()); } catch (requestError) { setError(requestError.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function submit(event) {
    event.preventDefault(); setError(''); setNotice('');
    try { await createRecoveryRequest({ email, reason }); setEmail(''); setReason(''); setNotice('Recovery request submitted.'); await load(); }
    catch (requestError) { setError(requestError.message); }
  }

  async function approve(event) {
    event.preventDefault(); setError('');
    try {
      const result = await approveRecoveryRequest(selected.id, { totpCode: totp });
      setTotp(''); setSelected(null); setNotice(result.setupUrl ? `Approved. Give the user this recovery link: ${window.location.origin}${result.setupUrl}` : 'Approval recorded; the second Board approval is still required.'); await load();
    } catch (requestError) { setError(requestError.message); }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link className="text-sm font-semibold text-teal hover:underline" to="/dashboard">Back to dashboard</Link>
        <h1 className="mt-6 text-3xl font-semibold text-ink">Account recovery</h1>
        <p className="mt-2 text-sm text-slate-600">Administrator recovery requires both Board members. Board Member and Staff recovery requires Administrator approval.</p>
        <form className="mt-6 grid gap-4 rounded-2xl bg-white p-6 shadow-sm sm:grid-cols-2" onSubmit={submit}>
          <label className="field-label">Account email<input className="field-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field-label sm:col-span-2">Reason<textarea className="field-input min-h-24 resize-y" value={reason} onChange={(event) => setReason(event.target.value)} required /></label>
          <button className="button-primary w-fit" type="submit">Request recovery</button>
        </form>
        {error && <p className="mt-4 text-sm text-rose-700" role="alert">{error}</p>}
        {notice && <p className="mt-4 text-sm text-emerald-700" role="status">{notice}</p>}
        <section className="mt-8 grid gap-4">
          {rows.map((row) => (
            <article className="rounded-2xl bg-white p-5 shadow-sm" key={row.id}>
              <p className="font-semibold text-ink">{row.target_name} · {row.target_email}</p>
              <p className="mt-1 text-sm text-slate-600">{row.target_role} · {row.status} · approvals: {row.approval_count}</p>
              <p className="mt-2 text-sm text-slate-600">{row.reason}</p>
              {row.status === 'PENDING_APPROVAL' && (
                <button className="button-secondary mt-4" onClick={() => setSelected(row)} type="button">Approve</button>
              )}
            </article>
          ))}
        </section>
        {selected && (
          <form className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-5" onSubmit={approve}>
            <div className="w-full max-w-md rounded-2xl bg-white p-6">
              <h2 className="text-lg font-semibold text-ink">Approve recovery</h2>
              <label className="field-label mt-4">Current authenticator code<input className="field-input" inputMode="numeric" maxLength={6} value={totp} onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
              <div className="mt-5 flex gap-3"><button className="button-primary" type="submit">Approve</button><button className="button-secondary" onClick={() => setSelected(null)} type="button">Cancel</button></div>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
