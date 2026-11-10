import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { buildAuthenticatorUri, makeAuthenticatorSecret } from '../utils/authenticator.js';

export default function OfficerMfaEnrollmentPage() {
  const navigate = useNavigate();
  const { user, pendingMfaEnrollment, completeMfaEnrollment } = useAuth();
  const [secret] = useState(makeAuthenticatorSecret);
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const email = pendingMfaEnrollment?.user.email || '';
  const authenticatorUri = useMemo(
    () => email ? buildAuthenticatorUri(secret, email) : '',
    [secret, email],
  );

  if (user) return <Navigate to="/dashboard" replace />;
  if (!pendingMfaEnrollment) return <Navigate to="/login" replace />;

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
    setSubmitting(true);
    try {
      await completeMfaEnrollment({ totpSecret: secret, totpCode });
      navigate('/dashboard', { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-10 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <Link className="text-sm font-semibold text-teal hover:underline" to="/login">Back to sign in</Link>
        <section className="mt-6 rounded-3xl bg-white p-6 shadow-card sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">First sign-in security</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Enroll your authenticator</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {pendingMfaEnrollment.user.name}, add <strong className="text-ink">{email}</strong> to your authenticator app. This one-time enrollment expires in {pendingMfaEnrollment.expiresInMinutes} minutes.
          </p>
          <div className="mt-7 rounded-2xl border border-teal/20 bg-teal/5 p-5">
            <p className="text-sm leading-6 text-slate-600">
              Enter this private key in your authenticator app. It creates a time-based one-time password (TOTP). Do not share or save the key in an untrusted place.
            </p>
            <div className="mt-4 rounded-xl bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Authenticator setup key</p>
              <code className="mt-2 block break-all text-sm font-bold tracking-wider text-ink">{secret}</code>
              <button className="button-secondary mt-3" onClick={copySecret} type="button">
                {copied ? 'Copied' : 'Copy key'}
              </button>
            </div>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-semibold text-teal">Manual setup details</summary>
              <code className="mt-2 block break-all rounded-lg bg-white p-3 text-xs text-slate-700">{authenticatorUri}</code>
            </details>
          </div>
          <form className="mt-7 grid gap-5" onSubmit={submit}>
            <label className="field-label">
              Current authenticator code
              <input
                autoComplete="one-time-code"
                className="field-input"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                pattern="[0-9]{6}"
                required
                value={totpCode}
              />
            </label>
            {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
            <button className="button-primary" disabled={submitting} type="submit">
              {submitting ? 'Enrolling securely…' : 'Verify and finish enrollment'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
