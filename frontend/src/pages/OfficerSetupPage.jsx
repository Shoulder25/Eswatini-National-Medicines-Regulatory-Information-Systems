import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  completeOfficerSetup,
  inspectOfficerSetupToken,
} from '../services/officerReplacements.js';
import { buildAuthenticatorUri, makeAuthenticatorSecret } from '../utils/authenticator.js';

export default function OfficerSetupPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '');
  const [officer, setOfficer] = useState(null);
  const [secret] = useState(makeAuthenticatorSecret);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [copied, setCopied] = useState(false);
  const authenticatorUri = useMemo(
    () => officer ? buildAuthenticatorUri(secret, officer.email) : '',
    [secret, officer],
  );

  useEffect(() => {
    if (location.search) navigate('/setup-officer', { replace: true });
  }, [location.search, navigate]);

  useEffect(() => {
    let active = true;
    if (!token) {
      setError('This setup link is missing or invalid. Ask the approving Officer to reissue it.');
      setLoading(false);
      return () => { active = false; };
    }
    inspectOfficerSetupToken(token)
      .then((result) => { if (active) setOfficer(result); })
      .catch((requestError) => { if (active) setError(requestError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError('Could not copy the authenticator key. Select and copy it manually.');
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await completeOfficerSetup({ token, password, totpSecret: secret, totpCode });
      setComplete(true);
      setPassword('');
      setConfirmation('');
      setTotpCode('');
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
          <h1 className="text-2xl font-semibold text-ink">Officer setup complete</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your password and authenticator are set. Sign in now to complete the successful test sign-in and activate the position handover.
          </p>
          <Link className="button-primary mt-7" to="/login">Go to sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <Link className="text-sm font-semibold text-teal hover:underline" to="/login">Back to sign in</Link>
        <section className="mt-6 rounded-3xl bg-white p-6 shadow-card sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Approved Officer replacement</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Set up your Officer account</h1>
          {loading ? <p className="mt-6 text-sm text-slate-600" role="status">Verifying the single-use setup link…</p> : officer ? (
            <>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                This link is for <strong className="text-ink">{officer.name}</strong> ({officer.email}) and expires {new Date(officer.expiresAt).toLocaleString()}.
              </p>
              <div className="mt-7 rounded-2xl border border-teal/20 bg-teal/5 p-5">
                <h2 className="font-semibold text-ink">Enroll your authenticator</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">Add this account in an authenticator app using the private key below.</p>
                <div className="mt-4 rounded-xl bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Authenticator setup key</p>
                  <code className="mt-2 block break-all text-sm font-bold tracking-wider text-ink">{secret}</code>
                  <button className="button-secondary mt-3" onClick={copySecret} type="button">{copied ? 'Copied' : 'Copy key'}</button>
                </div>
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-semibold text-teal">Manual setup details</summary>
                  <code className="mt-2 block break-all rounded-lg bg-white p-3 text-xs text-slate-700">{authenticatorUri}</code>
                </details>
              </div>
              <form className="mt-7 grid gap-5" onSubmit={submit}>
                <label className="field-label">
                  Password (at least 12 characters)
                  <input autoComplete="new-password" className="field-input" maxLength={1024} minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
                </label>
                <label className="field-label">
                  Confirm password
                  <input autoComplete="new-password" className="field-input" maxLength={1024} minLength={12} onChange={(event) => setConfirmation(event.target.value)} required type="password" value={confirmation} />
                </label>
                <label className="field-label">
                  Current authenticator code
                  <input autoComplete="one-time-code" className="field-input" inputMode="numeric" maxLength={6} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" required value={totpCode} />
                </label>
                {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
                <button className="button-primary" disabled={submitting} type="submit">{submitting ? 'Saving securely…' : 'Complete Officer setup'}</button>
              </form>
            </>
          ) : <p className="mt-4 text-sm leading-6 text-rose-700" role="alert">{error}</p>}
          {error && officer && <p className="mt-4 text-sm text-rose-700" role="alert">{error}</p>}
        </section>
      </div>
    </main>
  );
}
