import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PERMISSION_CODES } from '../config/roles.js';
import {
  createMedicineRegistration,
  decideMedicineRegistration,
  evaluateMedicineRegistration,
  getMedicineRegistrations,
} from '../services/medicineRegistrations.js';
import { downloadCmsProducts, importCmsProducts } from '../services/cmsProducts.js';

const initialForm = {
  applicationType: 'NEW',
  productCode: '',
  dispensable: 'dispensingUnit:each',
  productName: '',
  productDescription: '',
  packSize: '',
  packRoundingThreshold: '1',
  roundToZero: false,
  holderName: '',
  holderCountry: 'SWZ',
  details: {
    applicantName: '',
    applicantBusinessAddress: '',
    applicantPostalAddress: '',
    applicantTelephone: '',
    applicantEmail: '',
    applicantMasterFileNumber: '',
    pharmacistName: '',
    pharmacistBusinessAddress: '',
    pharmacistTelephone: '',
    pharmacistEmail: '',
    category: '',
    pharmacologicalClassification: '',
    approvedNames: '',
    strength: '',
    biologicalDescription: '',
    routeOfAdministration: '',
    countryOfOrigin: '',
    manufacturerName: '',
    manufacturerAddress: '',
    manufacturerMasterFileNumber: '',
    manufacturerSubmissionDate: '',
    manufacturerLicenceNumber: '',
    manufacturerLicenceIssueDate: '',
    primaryPackerName: '',
    primaryPackerAddress: '',
    primaryPackerMasterFileNumber: '',
    primaryPackerSubmissionDate: '',
    primaryPackerLicenceNumber: '',
    primaryPackerLicenceIssueDate: '',
    secondaryPackerName: '',
    secondaryPackerAddress: '',
    secondaryPackerMasterFileNumber: '',
    secondaryPackerSubmissionDate: '',
    secondaryPackerLicenceNumber: '',
    secondaryPackerLicenceIssueDate: '',
    releaseControlName: '',
    releaseControlAddress: '',
    releaseControlMasterFileNumber: '',
    releaseControlSubmissionDate: '',
    releaseControlLicenceNumber: '',
    releaseControlLicenceIssueDate: '',
    releaseResponsibilityName: '',
    releaseResponsibilityAddress: '',
    releaseResponsibilityMasterFileNumber: '',
    releaseResponsibilitySubmissionDate: '',
    releaseResponsibilityLicenceNumber: '',
    releaseResponsibilityLicenceIssueDate: '',
    medicineType: '',
    submissionType: '',
    efficacyData: '',
    qualifiedPharmacovigilanceName: '',
    qualifiedPharmacovigilanceAddress: '',
    qualifiedPharmacovigilanceTelephone: '',
    qualifiedPharmacovigilanceEmail: '',
    variationHistory: '',
    pharmacistSignature: '',
    declarationName: '',
    declarationDesignation: '',
    initialApplicationDate: '',
    lastRenewalDate: '',
    currentVariationDate: '',
  },
};

const SAHPRA_FORMS = Object.freeze({
  application: {
    label: 'Medicines Application Form Module 1.2.1',
    description: 'Administrative application form for registration, variation, or renewal.',
    document: 'GLF-BAU-HPA-07A · Version 7',
    url: 'https://www.sahpra.org.za/wp-content/uploads/2022/09/GLF-BAU-HPA-07A_v7-Medicines-Application-Form-M1.2.1.docx',
  },
  screening: {
    label: 'Screening Checklist for New Medicine Applications',
    description: 'Checklist used to verify that the dossier contains the information required for evaluation.',
    document: 'GLF-HPA-07C · Version 2',
    url: 'https://www.sahpra.org.za/wp-content/uploads/2026/02/GLF-HPA-07C_v2-Technical-Checklist-for-Screening.docx',
  },
});

export default function MedicineRegistrationsPage() {
  const { user } = useAuth();
  const permissions = user.permissions || [];
  const mayManage = permissions.includes(PERMISSION_CODES.MANAGE_REGISTRATION);
  const mayEvaluate = permissions.includes(PERMISSION_CODES.EVALUATE_REGISTRATION);
  const mayApprove = permissions.includes(PERMISSION_CODES.APPROVE_REGULATORY_DECISIONS);
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [selected, setSelected] = useState(null);
  const [evaluation, setEvaluation] = useState({ outcome: 'RECOMMEND_APPROVAL', dossierComplete: true, findings: '', conditions: '' });
  const [decision, setDecision] = useState({ decision: 'APPROVE', registrationNumber: '', reason: '' });
  const [selectedSahpraForm, setSelectedSahpraForm] = useState('application');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cmsFile, setCmsFile] = useState(null);

  function updateDetail(name, value) {
    setForm((current) => ({ ...current, details: { ...current.details, [name]: value } }));
  }

  async function importCmsWorkbook() {
    if (!cmsFile) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await importCmsProducts(cmsFile);
      setMessage(`Imported ${result.productsImported} products and ${result.programmesImported} programme records. Rejected rows: ${result.rejected.length}.`);
      setCmsFile(null);
      await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  async function exportCmsWorkbook() {
    setBusy(true); setError('');
    try {
      const blob = await downloadCmsProducts();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'CMS Products Export.xlsx'; anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  async function load() {
    try {
      setRows(await getMedicineRegistrations());
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function submitApplication(event) {
    event.preventDefault();
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await createMedicineRegistration(form);
      setForm(initialForm);
      setMessage(`Application ${result.applicationNumber} submitted.`);
      await load();
    } catch (requestError) {
      setError(requestError.message);
    } finally { setBusy(false); }
  }

  async function submitEvaluation(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await evaluateMedicineRegistration(selected.id, evaluation);
      setSelected(null); setMessage('Evaluation saved.'); await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  async function submitDecision(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await decideMedicineRegistration(selected.id, decision);
      setSelected(null); setMessage('Final decision saved.'); await load();
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <Link className="text-sm font-semibold text-teal" to="/dashboard">← Dashboard</Link>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Product registration</p>
            <h1 className="mt-2 text-3xl font-semibold text-ink">Medicine applications</h1>
          </div>
          <p className="text-sm text-slate-600">Submit, evaluate, and approve market-registration applications.</p>
        </div>

        {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>}

        <section className="mt-6 rounded-2xl border border-teal/20 bg-teal/5 p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Reference form</p>
          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="block text-sm font-semibold text-slate-700">
              Select the SAHPRA form to download
              <select className="field mt-2" value={selectedSahpraForm} onChange={(event) => setSelectedSahpraForm(event.target.value)}>
                {Object.entries(SAHPRA_FORMS).map(([key, formOption]) => (
                  <option key={key} value={key}>{formOption.label}</option>
                ))}
              </select>
            </label>
            <a
              className="button-secondary text-center"
              href={SAHPRA_FORMS[selectedSahpraForm].url}
              rel="noreferrer"
              target="_blank"
            >
              Download form
            </a>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            {SAHPRA_FORMS[selectedSahpraForm].description} {SAHPRA_FORMS[selectedSahpraForm].document}.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Source: South African Health Products Regulatory Authority (SAHPRA). Use the official document as a reference for the applicant dossier; this eNMRIS form captures the initial regulatory record.
          </p>
        </section>

        {mayManage && (
          <section className="mt-6 rounded-2xl bg-white p-6 shadow-card">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">CMS product register</p>
            <h2 className="mt-2 text-lg font-semibold text-ink">Import or export the CMS workbook</h2>
            <p className="mt-2 text-sm text-slate-600">Use the <code>products</code> and <code>programProducts</code> sheets from the CMS Products Template. Existing product codes and programme rows are updated without creating duplicates.</p>
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
              <label className="block flex-1 text-sm font-semibold text-slate-700">
                CMS workbook (.xlsx)
                <input
                  className="field mt-2 block w-full"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  type="file"
                  onChange={(event) => setCmsFile(event.target.files?.[0] || null)}
                />
              </label>
              <button className="button-primary" disabled={busy || !cmsFile} onClick={importCmsWorkbook} type="button">Import workbook</button>
              <button className="button-secondary" disabled={busy} onClick={exportCmsWorkbook} type="button">Export workbook</button>
            </div>
          </section>
        )}

        {mayManage && (
          <form className="mt-6 rounded-2xl bg-white p-6 shadow-card" onSubmit={submitApplication}>
            <h2 className="text-lg font-semibold text-ink">New registration</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <select
                aria-label="Registration type"
                className="field"
                value={form.applicationType}
                onChange={(event) => setForm({ ...form, applicationType: event.target.value })}
              >
                <option value="NEW">New registration</option>
                <option value="RENEWAL">Renewal</option>
                <option value="TRANSFER">Transfer</option>
              </select>
              <label className="text-sm font-semibold text-slate-700">
                Product code
                <input className="field mt-2" required value={form.productCode} onChange={(event) => setForm({ ...form, productCode: event.target.value })} />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Medicine name
                <input className="field mt-2" required value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Dosage form / dispensing unit
                <input className="field mt-2" required value={form.dispensable} onChange={(event) => setForm({ ...form, dispensable: event.target.value })} />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Pack size
                <input className="field mt-2" min="0" required type="number" value={form.packSize} onChange={(event) => setForm({ ...form, packSize: event.target.value })} />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Pack rounding threshold
                <input className="field mt-2" min="0" required type="number" value={form.packRoundingThreshold} onChange={(event) => setForm({ ...form, packRoundingThreshold: event.target.value })} />
              </label>
              <label className="flex items-center gap-3 pt-8 text-sm font-semibold text-slate-700">
                <input checked={form.roundToZero} onChange={(event) => setForm({ ...form, roundToZero: event.target.checked })} type="checkbox" />
                Round fractional packs to zero
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Registration holder
                <input className="field mt-2" required value={form.holderName} onChange={(event) => setForm({ ...form, holderName: event.target.value })} />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Country code
                <input className="field mt-2" maxLength="3" required value={form.holderCountry} onChange={(event) => setForm({ ...form, holderCountry: event.target.value.toUpperCase() })} />
              </label>
            </div>
            <div className="mt-8 border-t border-slate-100 pt-6">
              <h3 className="text-base font-semibold text-ink">Medicine particulars</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {[
                  ['category', 'Category'],
                  ['pharmacologicalClassification', 'Pharmacological classification'],
                  ['approvedNames', 'Approved name(s)'],
                  ['strength', 'Strength per dosage unit'],
                  ['biologicalDescription', 'Descriptive name of biological medicine'],
                  ['routeOfAdministration', 'Route of administration'],
                  ['countryOfOrigin', 'Country of origin'],
                ].map(([name, label]) => (
                  <label className="block text-sm font-semibold text-slate-700" key={name}>
                    {label}
                    <input className="field mt-2 block w-full" value={form.details[name]} onChange={(event) => updateDetail(name, event.target.value)} />
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-8 border-t border-slate-100 pt-6">
              <h3 className="text-base font-semibold text-ink">Manufacturing, packaging and testing sites</h3>
              <p className="mt-2 text-sm text-slate-500">Enter the relevant site details and licence references from the dossier.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {[
                  ['manufacturerName', 'Manufacturer name'],
                  ['manufacturerAddress', 'Manufacturer physical address'],
                  ['manufacturerMasterFileNumber', 'Manufacturer Site Master File reference'],
                  ['manufacturerSubmissionDate', 'Manufacturer submission date', 'date'],
                  ['manufacturerLicenceNumber', 'Manufacturer licence number'],
                  ['manufacturerLicenceIssueDate', 'Manufacturer licence issue date', 'date'],
                  ['primaryPackerName', 'Primary packer name'],
                  ['primaryPackerAddress', 'Primary packer physical address'],
                  ['primaryPackerMasterFileNumber', 'Primary packer Site Master File reference'],
                  ['primaryPackerSubmissionDate', 'Primary packer submission date', 'date'],
                  ['primaryPackerLicenceNumber', 'Primary packer licence number'],
                  ['primaryPackerLicenceIssueDate', 'Primary packer licence issue date', 'date'],
                  ['secondaryPackerName', 'Secondary packer name'],
                  ['secondaryPackerAddress', 'Secondary packer physical address'],
                  ['secondaryPackerMasterFileNumber', 'Secondary packer Site Master File reference'],
                  ['secondaryPackerSubmissionDate', 'Secondary packer submission date', 'date'],
                  ['secondaryPackerLicenceNumber', 'Secondary packer licence number'],
                  ['secondaryPackerLicenceIssueDate', 'Secondary packer licence issue date', 'date'],
                  ['releaseControlName', 'Finished product release control name'],
                  ['releaseControlAddress', 'Finished product release control address'],
                  ['releaseControlMasterFileNumber', 'Release control Site Master File reference'],
                  ['releaseControlSubmissionDate', 'Release control submission date', 'date'],
                  ['releaseControlLicenceNumber', 'Release control licence number'],
                  ['releaseControlLicenceIssueDate', 'Release control licence issue date', 'date'],
                  ['releaseResponsibilityName', 'Finished product release responsibility name'],
                  ['releaseResponsibilityAddress', 'Finished product release responsibility address'],
                  ['releaseResponsibilityMasterFileNumber', 'Release responsibility Site Master File reference'],
                  ['releaseResponsibilitySubmissionDate', 'Release responsibility submission date', 'date'],
                  ['releaseResponsibilityLicenceNumber', 'Release responsibility licence number'],
                  ['releaseResponsibilityLicenceIssueDate', 'Release responsibility licence issue date', 'date'],
                ].map(([name, label, type = 'text']) => (
                  <label className="block text-sm font-semibold text-slate-700" key={name}>
                    {label}
                    <input className="field mt-2 block w-full" type={type} value={form.details[name]} onChange={(event) => updateDetail(name, event.target.value)} />
                  </label>
                ))}
              </div>
            </div>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Product description
              <textarea className="field mt-2 block min-h-24 w-full" value={form.productDescription} onChange={(event) => setForm({ ...form, productDescription: event.target.value })} />
            </label>
            <div className="mt-8 border-t border-slate-100 pt-6">
              <h3 className="text-base font-semibold text-ink">Application type and declarations</h3>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {[
                  ['medicineType', 'Medicine type'],
                  ['submissionType', 'Submission type'],
                  ['efficacyData', 'Data submitted as proof of efficacy'],
                  ['qualifiedPharmacovigilanceName', 'Qualified pharmacovigilance person'],
                  ['qualifiedPharmacovigilanceAddress', 'Pharmacovigilance business address'],
                  ['qualifiedPharmacovigilanceTelephone', 'Pharmacovigilance 24-hour telephone'],
                  ['qualifiedPharmacovigilanceEmail', 'Pharmacovigilance email', 'email'],
                  ['pharmacistSignature', 'Pharmacist signature / confirmation'],
                  ['declarationName', 'Name in block letters'],
                  ['declarationDesignation', 'Designation'],
                  ['initialApplicationDate', 'Date of initial application', 'date'],
                  ['lastRenewalDate', 'Date of last renewal', 'date'],
                  ['currentVariationDate', 'Date of current variation / renewal', 'date'],
                ].map(([name, label, type = 'text']) => (
                  <label className="block text-sm font-semibold text-slate-700" key={name}>
                    {label}
                    <input className="field mt-2 block w-full" type={type} value={form.details[name]} onChange={(event) => updateDetail(name, event.target.value)} />
                  </label>
                ))}
              </div>
              <label className="mt-4 block text-sm font-semibold text-slate-700">
                Variation and renewal history
                <textarea className="field mt-2 block min-h-24 w-full" value={form.details.variationHistory} onChange={(event) => updateDetail('variationHistory', event.target.value)} />
              </label>
            </div>
            <button className="button-primary mt-5" disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit application'}</button>
          </form>
        )}

        <section className="mt-6 overflow-hidden rounded-2xl bg-white shadow-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3">Application</th><th className="px-5 py-3">Product</th><th className="px-5 py-3">Holder</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-4 font-semibold text-ink">{row.application_number}</td>
                    <td className="px-5 py-4">{row.product_name}<span className="block text-xs text-slate-500">{row.product_code}</span></td>
                    <td className="px-5 py-4">{row.holder_name}</td>
                    <td className="px-5 py-4">{row.status}</td>
                    <td className="px-5 py-4">
                      {((mayEvaluate && ['SUBMITTED', 'MORE_INFORMATION'].includes(row.status)) || (mayApprove && row.status === 'EVALUATED')) && (
                        <button className="button-secondary" type="button" onClick={() => setSelected(row)}>Open</button>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && <tr><td className="px-5 py-8 text-center text-slate-500" colSpan="5">No applications yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {selected && (
          <section className="mt-6 rounded-2xl bg-white p-6 shadow-card">
            <h2 className="text-lg font-semibold text-ink">{selected.application_number} · {selected.product_name}</h2>
            {mayEvaluate && ['SUBMITTED', 'MORE_INFORMATION'].includes(selected.status) && (
              <form className="mt-4" onSubmit={submitEvaluation}>
                <label className="block text-sm font-semibold text-slate-700">Evaluation outcome
                  <select className="field mt-2" value={evaluation.outcome} onChange={(event) => setEvaluation({ ...evaluation, outcome: event.target.value })}>
                    <option value="RECOMMEND_APPROVAL">Recommend approval</option><option value="RECOMMEND_REJECTION">Recommend rejection</option><option value="REQUEST_INFORMATION">Request information</option>
                  </select>
                </label>
                <label className="mt-4 block text-sm font-semibold text-slate-700">Findings
                  <textarea className="field mt-2 min-h-32" required value={evaluation.findings} onChange={(event) => setEvaluation({ ...evaluation, findings: event.target.value })} />
                </label>
                <button className="button-primary mt-4" disabled={busy} type="submit">Save evaluation</button>
              </form>
            )}
            {mayApprove && selected.status === 'EVALUATED' && (
              <form className="mt-4" onSubmit={submitDecision}>
                <label className="block text-sm font-semibold text-slate-700">Decision
                  <select className="field mt-2" value={decision.decision} onChange={(event) => setDecision({ ...decision, decision: event.target.value })}>
                    <option value="APPROVE">Approve</option><option value="REJECT">Reject</option>
                  </select>
                </label>
                {decision.decision === 'APPROVE' && <input className="field mt-4" placeholder="Registration number" required value={decision.registrationNumber} onChange={(event) => setDecision({ ...decision, registrationNumber: event.target.value })} />}
                <textarea className="field mt-4 min-h-24" placeholder="Decision reason" required value={decision.reason} onChange={(event) => setDecision({ ...decision, reason: event.target.value })} />
                <button className="button-primary mt-4" disabled={busy} type="submit">Record final decision</button>
              </form>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
