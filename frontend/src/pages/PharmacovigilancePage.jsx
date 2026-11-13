import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PERMISSION_CODES } from '../config/roles.js';
import { getPharmacovigilanceReports, reviewPharmacovigilanceReport, submitPharmacovigilanceReport } from '../services/pharmacovigilance.js';

const initialReport = { productCode: '', batchCode: '', reportType: 'ADVERSE_DRUG_REACTION', severity: 'NON_SERIOUS', description: '', reporterName: '', reporterContact: '' };

export default function PharmacovigilancePage() {
  const { user } = useAuth();
  const mayManage = (user.permissions || []).includes(PERMISSION_CODES.MANAGE_PHARMACOVIGILANCE);
  const [rows, setRows] = useState([]);
  const [report, setReport] = useState(initialReport);
  const [selected, setSelected] = useState(null);
  const [review, setReview] = useState({ status: 'UNDER_REVIEW', findings: '', resolution: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setRows(await getPharmacovigilanceReports()); } catch (requestError) { setError(requestError.message); }
  }
  useEffect(() => { load(); }, []);
  function update(name, value) { setReport((current) => ({ ...current, [name]: value })); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await submitPharmacovigilanceReport(report); setReport(initialReport); setMessage(`Report ${result.reportNumber} submitted.`); await load(); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }
  async function submitReview(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await reviewPharmacovigilanceReport(selected.id, review); setSelected(null); setMessage('Report review recorded.'); await load(); }
    catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link className="text-sm font-semibold text-teal" to="/dashboard">← Dashboard</Link>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-teal">Pharmacovigilance</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Safety reports</h1>
        <p className="mt-2 text-sm text-slate-600">Record suspected adverse reactions, medication errors, and quality defects. Do not enter patient-identifying information.</p>
        {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}
        {mayManage && <form className="mt-6 rounded-2xl bg-white p-6 shadow-card" onSubmit={submit}><h2 className="text-lg font-semibold text-ink">New safety report</h2><div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700">Product code<input className="field mt-2 block w-full" value={report.productCode} onChange={(event) => update('productCode', event.target.value)} /></label>
          <label className="block text-sm font-semibold text-slate-700">Batch code<input className="field mt-2 block w-full" value={report.batchCode} onChange={(event) => update('batchCode', event.target.value)} /></label>
          <label className="block text-sm font-semibold text-slate-700">Report type<select className="field mt-2 block w-full" value={report.reportType} onChange={(event) => update('reportType', event.target.value)}><option value="ADVERSE_DRUG_REACTION">Adverse drug reaction</option><option value="MEDICATION_ERROR">Medication error</option><option value="QUALITY_DEFECT">Quality defect</option><option value="OTHER">Other</option></select></label>
          <label className="block text-sm font-semibold text-slate-700">Severity<select className="field mt-2 block w-full" value={report.severity} onChange={(event) => update('severity', event.target.value)}><option value="NON_SERIOUS">Non-serious</option><option value="SERIOUS">Serious</option><option value="LIFE_THREATENING">Life-threatening</option><option value="FATAL">Fatal</option></select></label>
          <label className="block text-sm font-semibold text-slate-700">Reporter name<input className="field mt-2 block w-full" required value={report.reporterName} onChange={(event) => update('reporterName', event.target.value)} /></label>
          <label className="block text-sm font-semibold text-slate-700">Reporter contact<input className="field mt-2 block w-full" value={report.reporterContact} onChange={(event) => update('reporterContact', event.target.value)} /></label>
          <label className="block text-sm font-semibold text-slate-700 md:col-span-2">Description<textarea className="field mt-2 block min-h-28 w-full" required value={report.description} onChange={(event) => update('description', event.target.value)} /></label>
        </div><button className="button-primary mt-6" disabled={busy} type="submit">Submit report</button></form>}
        <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-card"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Report</th><th className="px-5 py-3">Product</th><th className="px-5 py-3">Type / severity</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row) => <tr key={row.id}><td className="px-5 py-4 font-semibold">{row.report_number}</td><td className="px-5 py-4">{row.product_name || 'Not linked'}<span className="block text-xs text-slate-500">{row.batch_code || ''}</span></td><td className="px-5 py-4">{row.report_type}<span className="block text-xs text-slate-500">{row.severity}</span></td><td className="px-5 py-4">{row.status}</td><td className="px-5 py-4">{row.status !== 'CLOSED' && <button className="button-secondary" type="button" onClick={() => setSelected(row)}>Review</button>}</td></tr>)}{!rows.length && <tr><td className="px-5 py-8 text-center text-slate-500" colSpan="5">No safety reports yet.</td></tr>}</tbody></table></div></section>
        {selected && <form className="mt-6 rounded-2xl bg-white p-6 shadow-card" onSubmit={submitReview}><h2 className="text-lg font-semibold text-ink">Review {selected.report_number}</h2><label className="mt-4 block text-sm font-semibold text-slate-700">Status<select className="field mt-2 block w-full" value={review.status} onChange={(event) => setReview({ ...review, status: event.target.value })}><option value="UNDER_REVIEW">Under review</option><option value="CLOSED">Closed</option></select></label><label className="mt-4 block text-sm font-semibold text-slate-700">Findings<textarea className="field mt-2 block min-h-24 w-full" required value={review.findings} onChange={(event) => setReview({ ...review, findings: event.target.value })} /></label><label className="mt-4 block text-sm font-semibold text-slate-700">Resolution<textarea className="field mt-2 block min-h-24 w-full" value={review.resolution} onChange={(event) => setReview({ ...review, resolution: event.target.value })} /></label><button className="button-primary mt-4" disabled={busy} type="submit">Save review</button></form>}
      </div>
    </main>
  );
}
