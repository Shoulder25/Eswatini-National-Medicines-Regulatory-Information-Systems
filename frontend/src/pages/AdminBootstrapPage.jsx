import { useState } from 'react';
import { Link } from 'react-router-dom';
import AuthenticatorEnrollment from '../components/AuthenticatorEnrollment.jsx';
import PasswordInput from '../components/PasswordInput.jsx';
import { completeAdminBootstrap, prepareAdminBootstrap } from '../services/auth.js';

export default function AdminBootstrapPage() {
  const [setupType, setSetupType] = useState('');
  const [challenge, setChallenge] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  async function begin(event) {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      setChallenge(await prepareAdminBootstrap({ name, email, password }));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(challenge.totpSecret);
      setCopied(true);
    } catch {
      setError('Could not copy the authenticator key. Select and copy it manually.');
    }
  }

  async function finish(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const result = await completeAdminBootstrap({ token: challenge.token, totpCode });
      setRecoveryCodes(result.recoveryCodes || []);
      setComplete(true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (complete) {
    return (
      <main className="grid min-h-screen place-items-center bg-mist px-5 py-10">
        <section className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-card sm:p-10">
          <h1 className="text-2xl font-semibold text-ink">Administrator created</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your first eNMRIS Administrator account is ready. Sign in with the password and authenticator you just configured.
          </p>
          <p className="mt-4 text-sm font-semibold text-ink">Save these one-time recovery codes:</p>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-4 font-mono text-sm font-semibold text-ink">
            {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
          </div>
          <Link className="button-primary mt-7" to="/login">Go to sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen overflow-y-auto bg-mist px-5 py-2 sm:px-8">
      <div className="mx-auto w-full max-w-[500px]">
        <Link className="block text-center text-sm font-semibold text-teal hover:underline" to="/login">Back to sign in</Link>
        <section className="mt-2 rounded-[28px] border border-slate-200/80 bg-white p-4 text-center shadow-card sm:p-6">
          <div className="mb-2 text-center">
            <img alt="eNMRIS" className="mx-auto h-20 w-32 rounded-xl object-contain" src="/logo.jpg" />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal">First-time setup</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {setupType === 'admin' ? 'Create the first Administrator' : 'Choose an account type'}
          </h1>
          {!setupType ? (
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <button
                className="rounded-2xl border border-slate-200 p-5 text-center transition hover:border-teal hover:bg-teal/5"
                onClick={() => setSetupType('admin')}
                type="button"
              >
                <span className="text-lg font-semibold text-ink">Administrator</span>
                <span className="mt-2 block text-sm leading-6 text-slate-600">
                  Create the first account that manages the system and staff.
                </span>
              </button>
              <button
                className="rounded-2xl border border-slate-200 p-5 text-center transition hover:border-teal hover:bg-teal/5"
                onClick={() => setSetupType('staff')}
                type="button"
              >
                <span className="text-lg font-semibold text-ink">Staff</span>
                <span className="mt-2 block text-sm leading-6 text-slate-600">
                  Set up a Board Officer or Head of IT after an Administrator authorizes it.
                </span>
              </button>
            </div>
          ) : setupType === 'staff' ? (
            <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-sm leading-6 text-amber-900">
                Staff accounts cannot be created from the public first-install screen. Create the first Administrator, sign in, and use the Admin-authorized staff setup process.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button className="button-primary" onClick={() => setSetupType('admin')} type="button">
                  Create Administrator
                </button>
                <button className="button-secondary" onClick={() => setSetupType('')} type="button">
                  Choose again
                </button>
              </div>
            </div>
          ) : !challenge ? (
            <form className="mt-5 grid gap-3" onSubmit={begin}>
              <p className="text-xs leading-5 text-slate-600">
                Use this page only after installing the fresh eNMRIS database. The first Administrator controls later Officer setup.
              </p>
              <label className="field-label text-left text-xs">Full name<input className="field-input py-2 text-left text-xs" maxLength={160} onChange={(event) => setName(event.target.value)} required value={name} /></label>
              <label className="field-label text-left text-xs">Work email<input autoComplete="email" className="field-input py-2 text-left text-xs" maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></label>
              <label className="field-label text-left text-xs">
                Password (at least 12 characters)
                <PasswordInput autoComplete="new-password" className="py-2 text-xs" minLength={12} onChange={(event) => setPassword(event.target.value)} onToggle={() => setShowPassword((current) => !current)} required value={password} visible={showPassword} />
              </label>
              <label className="field-label text-left text-xs">
                Confirm password
                <PasswordInput autoComplete="new-password" className="py-2 text-xs" minLength={12} onChange={(event) => setConfirmation(event.target.value)} onToggle={() => setShowConfirmation((current) => !current)} required value={confirmation} visible={showConfirmation} />
              </label>
              {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
              <button className="button-primary" disabled={submitting} type="submit">{submitting ? 'Preparing securely…' : 'Continue to authenticator setup'}</button>
            </form>
          ) : (
            <>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Add the new Administrator authenticator and verify the current 6-digit code. This setup expires in {challenge.expiresInMinutes} minutes.
              </p>
              <AuthenticatorEnrollment copied={copied} onCopy={copySecret} secret={challenge.totpSecret} uri={challenge.otpauthUri} />
              <form className="mt-7 grid gap-5" onSubmit={finish}>
                <label className="field-label text-left">Current authenticator code<input autoComplete="one-time-code" className="field-input text-left" inputMode="numeric" maxLength={6} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" required value={totpCode} /></label>
                {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
                <button className="button-primary" disabled={submitting} type="submit">{submitting ? 'Creating securely…' : 'Create Administrator'}</button>
              </form>
            </>
          )}
          {setupType === 'admin' && !challenge && (
            <button className="mt-5 text-sm font-semibold text-slate-600 hover:text-ink" onClick={() => setSetupType('')} type="button">
              ← Choose a different account type
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
