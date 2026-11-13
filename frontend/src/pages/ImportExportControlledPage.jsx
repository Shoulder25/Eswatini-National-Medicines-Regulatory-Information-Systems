import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PERMISSION_CODES } from '../config/roles.js';
import {
  createControlledPermit,
  decideControlledPermit,
  getControlledPermits,
  verifyControlledPermit,
} from '../services/importExportControlled.js';

const initialDetails = {
  substanceName: '',
  quantity: '',
  unit: '',
  quotaYear: String(new Date().getFullYear()),
  importerExporterName: '',
  proformaInvoiceNumber: '',
  originCertificateNumber: '',
  portOfEntry: '',
  customsReference: '',
};

export default function ImportExportControlledPage() {
  const { user } = useAuth();
  const permissions = user.permissions || [];
  const mayManage = permissions.includes(PERMISSION_CODES.MANAGE_IMPORT_EXPORT_PERMITS);
  const mayVerify = permissions.includes(PERMISSION_CODES.MANAGE_CONTROLLED_SUBSTANCES);
  const mayApprove = permissions.includes(PERMISSION_CODES.APPROVE_REGULATORY_DECISIONS);
  const [data, setData] = useState({ permits: [], quota: [] });
  const [permitType, setPermitType] = useState('IMPORT');
  const [scheduleCode, setScheduleCode] = useState('SCHEDULE_5');
  const [details, setDetails] = useState(initialDetails);
  const [selected, setSelected] = useState(null);
  const [verification, setVerification] = useState({ outcome: 'VERIFIED', findings: '' });
  const [decision, setDecision] = useState({ decision: 'APPROVE', reason: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData(await getControlledPermits()); } catch (requestError) { setError(requestError.message); }
  }
  useEffect(() => { load(); }, []);
  function update(name, value) { setDetails((current) => ({ ...current, [name]: value })); }

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const result = await createControlledPermit({ permitType, scheduleCode, details });
      setDetails(initialDetails); setMessage(`Permit ${result.permitNumber} submitted.`); await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function verify(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await verifyControlledPermit(selected.id, verification); setSelected(null); setMessage('Customs verification recorded.'); await load(); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function decide(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await decideControlledPermit(selected.id, decision); setSelected(null); setMessage('Permit decision recorded.'); await load(); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link className="text-sm font-semibold text-teal" to="/dashboard">← Dashboard</Link>
        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Import/export control</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Controlled-substance permits</h1>
          <p className="mt-2 text-sm text-slate-600">Track scheduled-substance permits, customs verification, and annual quota usage.</p>
        </div>
        {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

        {mayManage && (
          <form className="mt-6 rounded-2xl bg-white p-6 shadow-card" onSubmit={submit}>
            <h2 className="text-lg font-semibold text-ink">New permit</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-700">Permit type<select className="field mt-2 block w-full" value={permitType} onChange={(event) => setPermitType(event.target.value)}><option value="IMPORT">Import</option><option value="EXPORT">Export</option></select></label>
              <label className="block text-sm font-semibold text-slate-700">Schedule<select className="field mt-2 block w-full" value={scheduleCode} onChange={(event) => setScheduleCode(event.target.value)}><option value="SCHEDULE_5">Schedule 5</option><option value="SCHEDULE_6">Schedule 6</option><option value="SCHEDULE_7">Schedule 7</option><option value="SCHEDULE_8">Schedule 8</option></select></label>
              {[
                ['substanceName', 'Substance name'], ['quantity', 'Quantity', 'number'], ['unit', 'Unit'],
                ['quotaYear', 'Quota year', 'number'], ['importerExporterName', 'Importer / exporter name'],
                ['proformaInvoiceNumber', 'Proforma invoice number'], ['originCertificateNumber', 'Certificate of origin number'],
                ['portOfEntry', 'Port of entry / exit'], ['customsReference', 'Customs reference'],
              ].map(([name, label, type = 'text']) => (
                <label className="block text-sm font-semibold text-slate-700" key={name}>{label}<input className="field mt-2 block w-full" required={name !== 'customsReference'} type={type} value={details[name]} onChange={(event) => update(name, event.target.value)} /></label>
              ))}
            </div>
            <button className="button-primary mt-6" disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit permit'}</button>
          </form>
        )}

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-2xl bg-white shadow-card">
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Permit</th><th className="px-5 py-3">Substance</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">
              {data.permits.map((row) => <tr key={row.id}><td className="px-5 py-4 font-semibold text-ink">{row.permit_number}</td><td className="px-5 py-4">{row.details?.substanceName}<span className="block text-xs text-slate-500">{row.schedule_code}</span></td><td className="px-5 py-4">{row.permit_type}</td><td className="px-5 py-4">{row.status}</td><td className="px-5 py-4">{((mayVerify && ['SUBMITTED', 'MORE_INFORMATION'].includes(row.status)) || (mayApprove && row.status === 'VERIFIED')) && <button className="button-secondary" type="button" onClick={() => setSelected(row)}>Open</button>}</td></tr>)}
              {!data.permits.length && <tr><td className="px-5 py-8 text-center text-slate-500" colSpan="5">No permits yet.</td></tr>}
            </tbody></table></div>
          </div>
          <aside className="rounded-2xl bg-white p-5 shadow-card"><h2 className="font-semibold text-ink">Annual quota</h2><div className="mt-4 space-y-3 text-sm">{data.quota.map((row) => <div className="border-b border-slate-100 pb-3" key={row.id}><p className="font-semibold">{row.substance_name} · {row.schedule_code}</p><p className="text-slate-500">{row.used_quantity} / {row.allocated_quantity} {row.unit} ({row.quota_year})</p></div>)}{!data.quota.length && <p className="text-slate-500">No quota records configured.</p>}</div></aside>
        </section>

        {selected && <section className="mt-6 rounded-2xl bg-white p-6 shadow-card"><h2 className="text-lg font-semibold text-ink">{selected.permit_number} · {selected.details?.substanceName}</h2>
          {mayVerify && ['SUBMITTED', 'MORE_INFORMATION'].includes(selected.status) && <form className="mt-4" onSubmit={verify}><label className="block text-sm font-semibold text-slate-700">Customs verification<select className="field mt-2 block w-full" value={verification.outcome} onChange={(event) => setVerification({ ...verification, outcome: event.target.value })}><option value="VERIFIED">Verified</option><option value="MORE_INFORMATION">More information required</option></select></label><label className="mt-4 block text-sm font-semibold text-slate-700">Findings<textarea className="field mt-2 block min-h-24 w-full" required value={verification.findings} onChange={(event) => setVerification({ ...verification, findings: event.target.value })} /></label><button className="button-primary mt-4" disabled={busy} type="submit">Save verification</button></form>}
          {mayApprove && selected.status === 'VERIFIED' && <form className="mt-4" onSubmit={decide}><label className="block text-sm font-semibold text-slate-700">Final decision<select className="field mt-2 block w-full" value={decision.decision} onChange={(event) => setDecision({ ...decision, decision: event.target.value })}><option value="APPROVE">Approve</option><option value="REJECT">Reject</option></select></label><label className="mt-4 block text-sm font-semibold text-slate-700">Decision reason<textarea className="field mt-2 block min-h-24 w-full" required value={decision.reason} onChange={(event) => setDecision({ ...decision, reason: event.target.value })} /></label><button className="button-primary mt-4" disabled={busy} type="submit">Record decision</button></form>}
        </section>}
      </div>
    </main>
  );
}
