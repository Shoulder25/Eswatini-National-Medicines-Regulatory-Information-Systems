import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

function Brand({ inverse = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`grid h-11 w-11 place-items-center rounded-2xl font-bold tracking-tight ${inverse ? 'bg-white/10 text-white ring-1 ring-white/15' : 'bg-ink text-white'}`}>
        eN
      </div>
      <div>
        <p className={`text-sm font-bold tracking-[0.12em] ${inverse ? 'text-white' : 'text-ink'}`}>eNMRIS</p>
        <p className={`mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${inverse ? 'text-slate-300' : 'text-slate-500'}`}>
          Medicines Regulatory Information
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { phase, user, error: sessionError, signIn, retry } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (phase === 'authenticated' && user) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await signIn({ email: email.trim(), password, totpCode: totpCode.trim() });
      setPassword('');
      setTotpCode('');
      if (result?.mfaEnrollmentRequired) navigate('/enroll-officer-mfa', { replace: true });
    } catch (error) {
      setFormError(error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-mist lg:grid lg:grid-cols-[minmax(380px,0.9fr)_1.1fr]">
      <aside className="relative hidden min-h-screen overflow-hidden bg-ink px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between xl:px-20">
        <div className="absolute -right-32 top-28 h-96 w-96 rounded-full border border-white/10" aria-hidden="true" />
        <div className="absolute -right-16 top-44 h-64 w-64 rounded-full border border-white/10" aria-hidden="true" />
        <div className="absolute bottom-20 right-20 h-40 w-40 rounded-full bg-teal/20 blur-3xl" aria-hidden="true" />
        <div className="relative">
          <Brand inverse />
          <div className="mt-28 max-w-xl">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-teal-200">Medicines oversight, connected</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight xl:text-5xl">
              A trusted view of medicines regulation in Eswatini.
            </h1>
            <p className="mt-6 max-w-md text-base leading-7 text-slate-300">
              Secure staff access to the national medicines register and regulatory information.
            </p>
          </div>
        </div>
        <div className="relative flex items-center gap-3 text-xs text-slate-300">
          <span className="h-2 w-2 rounded-full bg-teal-300" />
          Medicines Regulatory Authority · Eswatini
        </div>
      </aside>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-[460px]">
          <div className="mb-9 lg:hidden">
            <Brand />
          </div>
          <div className="rounded-[28px] border border-slate-200/80 bg-white p-7 shadow-card sm:p-10">
            <div className="mb-8">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Staff portal</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Welcome back</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Sign in with your staff account to continue.
              </p>
            </div>

            {sessionError && (
              <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
                <p>{sessionError.message}</p>
                <button className="mt-2 font-semibold underline underline-offset-2" onClick={retry} type="button">
                  Retry session check
                </button>
              </div>
            )}

            {formError && (
              <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
                <p>{formError.message}</p>
                {formError.requestId && (
                  <p className="mt-2 text-xs text-rose-700">Support reference: {formError.requestId}</p>
                )}
              </div>
            )}

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <label className="field-label" htmlFor="email">Work email</label>
                <input
                  autoComplete="username"
                  className="field-input"
                  id="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@organization.org"
                  required
                  type="email"
                  value={email}
                />
              </div>

              <div>
                <label className="field-label" htmlFor="password">Password</label>
                <input
                  autoComplete="current-password"
                  className="field-input"
                  id="password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </div>

              <div>
                <div className="flex items-end justify-between gap-3">
                  <label className="field-label mb-0" htmlFor="totpCode">Authenticator code</label>
                  <span className="text-xs font-medium text-slate-500">6 digits, if enrolled</span>
                </div>
                <input
                  autoComplete="one-time-code"
                  className="field-input mt-2 text-center font-mono text-lg tracking-[0.45em]"
                  id="totpCode"
                  inputMode="numeric"
                  maxLength={6}
                  name="totpCode"
                  onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  type="text"
                  value={totpCode}
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Enter your current authenticator code. Board Officers can leave this blank on their first sign-in to enroll.
                </p>
              </div>

              <button className="button-primary w-full" disabled={submitting} type="submit">
                {submitting ? 'Signing in…' : 'Sign in securely'}
                {!submitting && <span aria-hidden="true">→</span>}
              </button>
            </form>

            <div className="mt-7 flex items-start gap-3 border-t border-slate-100 pt-5 text-xs leading-5 text-slate-500">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-teal" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 10V7a5 5 0 0 1 10 0v3m-11 0h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
              </svg>
              <p>Your session is protected and expires after 20 minutes of inactivity.</p>
            </div>
          </div>
          <p className="mt-6 text-center text-xs text-slate-500">
            Need access? Contact your system administrator.
          </p>
        </div>
      </section>
    </main>
  );
}
