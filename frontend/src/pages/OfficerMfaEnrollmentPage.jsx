import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import AuthenticatorEnrollment from '../components/AuthenticatorEnrollment.jsx';

export default function OfficerMfaEnrollmentPage() {
  const navigate = useNavigate();
  const { user, pendingMfaEnrollment, completeMfaEnrollment } = useAuth();
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const email = pendingMfaEnrollment?.user.email || '';
  const secret = pendingMfaEnrollment?.totpSecret || '';

  if (user && !recoveryCodes) return <Navigate to="/dashboard" replace />;
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
      const session = await completeMfaEnrollment({ totpCode });
      setRecoveryCodes(session.recoveryCodes || []);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (recoveryCodes) {
    return (
      <main className="min-h-screen bg-mist px-5 py-10 sm:px-8">
        <section className="mx-auto max-w-2xl rounded-3xl bg-white p-6 shadow-card sm:p-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Save these recovery codes</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Authenticator recovery codes</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Store these codes somewhere secure. Each code works once if you lose access to your authenticator. They will not be shown again.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 rounded-2xl bg-slate-50 p-5 font-mono text-sm font-semibold text-ink sm:grid-cols-3">
            {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
          </div>
          <button className="button-primary mt-7" onClick={() => navigate('/dashboard', { replace: true })} type="button">
            I saved my recovery codes
          </button>
        </section>
      </main>
    );
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
            <AuthenticatorEnrollment
              copied={copied}
              onCopy={copySecret}
              secret={secret}
              uri={pendingMfaEnrollment.otpauthUri}
            />
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
