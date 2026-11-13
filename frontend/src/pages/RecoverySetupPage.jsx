import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthenticatorEnrollment from '../components/AuthenticatorEnrollment.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { completeRecovery, inspectRecoveryToken } from '../services/accountRecovery.js';

export default function RecoverySetupPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [details, setDetails] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [totp, setTotp] = useState('');
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  useEffect(() => { inspectRecoveryToken(token).then(setDetails).catch((requestError) => setError(requestError.message)); }, [token]);
  async function submit(event) {
    event.preventDefault(); setError('');
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    try { const result = await completeRecovery({ token, password, totpCode: totp }); setCodes(result.recoveryCodes || []); }
    catch (requestError) { setError(requestError.message); }
  }
  return <main className="min-h-screen overflow-y-auto bg-mist px-5 py-10"><section className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-card sm:p-10">
    <Link className="text-sm font-semibold text-teal hover:underline" to="/login">Back to sign in</Link>
    <h1 className="mt-5 text-3xl font-semibold text-ink">Recover your account</h1>
    {codes ? <><p className="mt-3 text-sm text-slate-600">Save these new one-time recovery codes.</p><div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-4 font-mono text-sm">{codes.map((code) => <code key={code}>{code}</code>)}</div></> : details ? <><p className="mt-3 text-sm text-slate-600">Set a new password and authenticator for {details.name} ({details.email}).</p><AuthenticatorEnrollment copied={false} onCopy={() => navigator.clipboard.writeText(details.totpSecret)} secret={details.totpSecret} uri={details.otpauthUri} /><form className="mt-6 grid gap-4" onSubmit={submit}><label className="field-label">New password<PasswordInput minLength={12} onChange={(event) => setPassword(event.target.value)} onToggle={() => setShowPassword((value) => !value)} required value={password} visible={showPassword} /></label><label className="field-label">Confirm password<PasswordInput minLength={12} onChange={(event) => setConfirmation(event.target.value)} onToggle={() => setShowConfirmation((value) => !value)} required value={confirmation} visible={showConfirmation} /></label><label className="field-label">Current authenticator code<input className="field-input" inputMode="numeric" maxLength={6} value={totp} onChange={(event) => setTotp(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></label><button className="button-primary" type="submit">Complete recovery</button></form></> : <p className="mt-4 text-sm text-rose-700">{error || 'Loading recovery request…'}</p>}
    {error && details && <p className="mt-4 text-sm text-rose-700">{error}</p>}
  </section></main>;
}
