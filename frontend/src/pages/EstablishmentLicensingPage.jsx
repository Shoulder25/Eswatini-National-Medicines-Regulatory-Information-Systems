import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PERMISSION_CODES } from '../config/roles.js';
import {
  createEstablishmentApplication,
  decideEstablishment,
  getEstablishmentApplications,
  inspectEstablishment,
} from '../services/establishmentLicensing.js';

const initialDetails = {
  businessName: '',
  physicalAddress: '',
  postalAddress: '',
  responsiblePharmacistName: '',
  responsiblePharmacistRegistration: '',
  responsiblePharmacistPhone: '',
  responsiblePharmacistEmail: '',
  companyRegistrationNumber: '',
  vatNumber: '',
  importerRegistrationNumber: '',
  intendsToImport: false,
  companyDocumentsIncluded: false,
  pharmacistGoodStandingIncluded: false,
  premisesPlanIncluded: false,
  gmpOrLicenceDocumentsIncluded: false,
};

export default function EstablishmentLicensingPage() {
  const { user } = useAuth();
  const permissions = user.permissions || [];
  const mayManage = permissions.includes(PERMISSION_CODES.MANAGE_ESTABLISHMENT_LICENSING);
  const mayInspect = permissions.includes(PERMISSION_CODES.CONDUCT_INSPECTIONS);
  const mayApprove = permissions.includes(PERMISSION_CODES.APPROVE_REGULATORY_DECISIONS);
  const [rows, setRows] = useState([]);
  const [details, setDetails] = useState(initialDetails);
  const [establishmentType, setEstablishmentType] = useState('RETAIL_PHARMACY');
  const [selected, setSelected] = useState(null);
  const [inspection, setInspection] = useState({ outcome: 'PASS', findings: '', conditions: '' });
  const [decision, setDecision] = useState({ decision: 'APPROVE', reason: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setRows(await getEstablishmentApplications()); } catch (requestError) { setError(requestError.message); }
  }

  useEffect(() => { load(); }, []);

  function update(name, value) {
    setDetails((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const result = await createEstablishmentApplication({ establishmentType, details });
      setDetails(initialDetails); setMessage(`Application ${result.applicationNumber} submitted.`); await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  async function submitInspection(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await inspectEstablishment(selected.id, inspection);
      setSelected(null); setMessage('Inspection recorded.'); await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  async function submitDecision(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await decideEstablishment(selected.id, decision);
      setSelected(null); setMessage('Licensing decision recorded.'); await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link className="text-sm font-semibold text-teal" to="/dashboard">← Dashboard</Link>
        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Establishment licensing</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Premises applications</h1>
          <p className="mt-2 text-sm text-slate-600">Register establishments, record inspections, and issue licensing decisions.</p>
        </div>
        {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

        {mayManage && (
          <form className="mt-6 rounded-2xl bg-white p-6 shadow-card" onSubmit={submit}>
            <h2 className="text-lg font-semibold text-ink">New establishment application</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-700">Establishment type
                <select className="field mt-2 block w-full" value={establishmentType} onChange={(event) => setEstablishmentType(event.target.value)}>
                  <option value="RETAIL_PHARMACY">Retail pharmacy</option><option value="WHOLESALER">Wholesale distributor</option><option value="MANUFACTURER">Manufacturer</option><option value="IMPORTER">Importer</option>
                </select>
              </label>
              {[
                ['businessName', 'Business name'], ['physicalAddress', 'Physical premises address'],
                ['postalAddress', 'Postal address'], ['responsiblePharmacistName', 'Responsible pharmacist name'],
                ['responsiblePharmacistRegistration', 'Pharmacist registration number'],
                ['responsiblePharmacistPhone', 'Pharmacist telephone'], ['responsiblePharmacistEmail', 'Pharmacist email', 'email'],
                ['companyRegistrationNumber', 'Company registration number'], ['vatNumber', 'VAT number'],
                ['importerRegistrationNumber', 'Importer registration number'],
              ].map(([name, label, type = 'text']) => (
                <label className="block text-sm font-semibold text-slate-700" key={name}>{label}
                  <input className="field mt-2 block w-full" type={type} value={details[name]} onChange={(event) => update(name, event.target.value)} />
                </label>
              ))}
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {[
                ['intendsToImport', 'Establishment intends to import medicines'],
                ['companyDocumentsIncluded', 'Company registration documents included'],
                ['pharmacistGoodStandingIncluded', 'Responsible pharmacist good-standing letter included'],
                ['premisesPlanIncluded', 'Premises plan included'],
                ['gmpOrLicenceDocumentsIncluded', 'GMP or manufacturing/licence documents included'],
              ].map(([name, label]) => (
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-700" key={name}>
                  <input checked={details[name]} onChange={(event) => update(name, event.target.checked)} type="checkbox" />{label}
                </label>
              ))}
            </div>
            <button className="button-primary mt-6" disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit establishment'}</button>
          </form>
        )}

        <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Application</th><th className="px-5 py-3">Business</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id}><td className="px-5 py-4 font-semibold text-ink">{row.application_number}</td><td className="px-5 py-4">{row.details?.businessName}</td><td className="px-5 py-4">{row.establishment_type}</td><td className="px-5 py-4">{row.status}</td><td className="px-5 py-4">{((mayInspect && ['SUBMITTED', 'MORE_INFORMATION'].includes(row.status)) || (mayApprove && row.status === 'INSPECTED')) && <button className="button-secondary" type="button" onClick={() => setSelected(row)}>Open</button>}</td></tr>
                ))}
                {!rows.length && <tr><td className="px-5 py-8 text-center text-slate-500" colSpan="5">No establishment applications yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {selected && (
          <section className="mt-6 rounded-2xl bg-white p-6 shadow-card">
            <h2 className="text-lg font-semibold text-ink">{selected.application_number} · {selected.details?.businessName}</h2>
            {mayInspect && ['SUBMITTED', 'MORE_INFORMATION'].includes(selected.status) && (
              <form className="mt-4" onSubmit={submitInspection}>
                <label className="block text-sm font-semibold text-slate-700">Inspection outcome
                  <select className="field mt-2 block w-full" value={inspection.outcome} onChange={(event) => setInspection({ ...inspection, outcome: event.target.value })}><option value="PASS">Pass</option><option value="FAIL">Fail</option><option value="MORE_INFORMATION">More information required</option></select>
                </label>
                <label className="mt-4 block text-sm font-semibold text-slate-700">Inspection findings<textarea className="field mt-2 block min-h-32 w-full" required value={inspection.findings} onChange={(event) => setInspection({ ...inspection, findings: event.target.value })} /></label>
                <button className="button-primary mt-4" disabled={busy} type="submit">Save inspection</button>
              </form>
            )}
            {mayApprove && selected.status === 'INSPECTED' && (
              <form className="mt-4" onSubmit={submitDecision}>
                <label className="block text-sm font-semibold text-slate-700">Licensing decision<select className="field mt-2 block w-full" value={decision.decision} onChange={(event) => setDecision({ ...decision, decision: event.target.value })}><option value="APPROVE">Approve</option><option value="REJECT">Reject</option></select></label>
                <label className="mt-4 block text-sm font-semibold text-slate-700">Decision reason<textarea className="field mt-2 block min-h-24 w-full" required value={decision.reason} onChange={(event) => setDecision({ ...decision, reason: event.target.value })} /></label>
                <button className="button-primary mt-4" disabled={busy} type="submit">Record decision</button>
              </form>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
