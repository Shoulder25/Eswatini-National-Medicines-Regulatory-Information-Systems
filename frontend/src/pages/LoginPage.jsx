import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

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
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [usingRecoveryCode, setUsingRecoveryCode] = useState(false);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (phase === 'authenticated' && user) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await signIn({
        email: email.trim(),
        password,
        ...(step === 2
          ? (usingRecoveryCode
            ? { recoveryCode: recoveryCode.trim() }
            : { totpCode: totpCode.trim() })
          : {}),
      });
      if (result?.mfaEnrollmentRequired) navigate('/enroll-officer-mfa', { replace: true });
      if (result?.mfaRequired) setStep(2);
    } catch (error) {
      setFormError(error);
    } finally {
      setSubmitting(false);
    }
  }

  function returnToCredentials() {
    setStep(1);
    setTotpCode('');
    setRecoveryCode('');
    setUsingRecoveryCode(false);
    setFormError(null);
  }

  return (
    <main className="h-screen overflow-hidden bg-mist">
      <aside className="hidden">
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

      <section className="flex h-full items-center justify-center px-5 py-2 sm:px-8">
        <div className="w-full max-w-[460px]">
          <div className="rounded-[28px] border border-slate-200/80 bg-white p-4 text-center shadow-card sm:p-6">
            <div className="mb-2 text-center">
              <img alt="eNMRIS" className="mx-auto h-20 w-32 rounded-xl object-contain" src="/logo.jpg" />
            </div>
            <div className="mb-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal">Staff portal · Step {step} of 2</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
                {step === 1 ? 'Welcome back' : 'Verify your authenticator'}
              </h2>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {step === 1
                  ? 'Enter your work email and password to continue.'
                  : 'Enter the current 6-digit code from your authenticator app.'}
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

            <form className="space-y-4" onSubmit={handleSubmit}>
              {step === 1 ? (
                <>
                  <div>
                    <label className="field-label text-left text-xs" htmlFor="email">Work email</label>
                    <input
                      autoComplete="username"
                      className="field-input py-2 text-left"
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
                    <label className="field-label text-left text-xs" htmlFor="password">Password</label>
                    <PasswordInput
                      autoComplete="current-password"
                      className="py-2"
                      id="password"
                      name="password"
                      onChange={(event) => setPassword(event.target.value)}
                      onToggle={() => setShowPassword((current) => !current)}
                      required
                      value={password}
                      visible={showPassword}
                    />
                  </div>
                </>
              ) : (
                <div>
                  <label className="field-label text-left text-xs" htmlFor={usingRecoveryCode ? 'recoveryCode' : 'totpCode'}>
                    {usingRecoveryCode ? 'Recovery code' : 'Authenticator code'}
                  </label>
                  <input
                    autoComplete="one-time-code"
                    autoFocus
                    className="field-input mt-2 py-2 text-left font-mono text-lg tracking-[0.2em]"
                    id={usingRecoveryCode ? 'recoveryCode' : 'totpCode'}
                    inputMode={usingRecoveryCode ? 'text' : 'numeric'}
                    maxLength={usingRecoveryCode ? 10 : 6}
                    onChange={(event) => (usingRecoveryCode
                      ? setRecoveryCode(event.target.value.replace(/[^a-z0-9]/gi, '').slice(0, 10).toUpperCase())
                      : setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6)))}
                    pattern={usingRecoveryCode ? '[A-Fa-f0-9]{10}' : '[0-9]{6}'}
                    placeholder={usingRecoveryCode ? 'XXXXXXXXXX' : '000000'}
                    required
                    type="text"
                    value={usingRecoveryCode ? recoveryCode : totpCode}
                  />
                </div>
              )}

              <button className="button-primary w-full" disabled={submitting} type="submit">
                {submitting ? 'Checking securely…' : step === 1 ? 'Continue' : 'Sign in securely'}
                {!submitting && <span aria-hidden="true">→</span>}
              </button>
            </form>

            {step === 2 && (
              <>
                <button className="mt-4 w-full text-sm font-semibold text-teal hover:text-ink" onClick={() => setUsingRecoveryCode((current) => !current)} type="button">
                  {usingRecoveryCode ? 'Use authenticator code instead' : 'Use a recovery code instead'}
                </button>
                <button className="mt-2 w-full text-sm font-semibold text-slate-600 hover:text-ink" onClick={returnToCredentials} type="button">
                  ← Use a different account
                </button>
              </>
            )}

            <div className="mt-4 border-t border-slate-100 pt-3 text-center text-xs leading-5 text-slate-500">
              <p>Your session is protected and expires after 20 minutes of inactivity.</p>
              <a className="mt-2 inline-block font-semibold text-teal hover:underline" href="/bootstrap-admin">
                First-time setup
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
