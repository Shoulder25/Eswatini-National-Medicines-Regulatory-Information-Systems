import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-ink text-sm font-bold text-white">eN</div>
      <div>
        <p className="text-sm font-bold tracking-[0.12em] text-ink">eNMRIS</p>
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500">Staff workspace</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, idleTimeoutMinutes, signOut } = useAuth();
  const [logoutError, setLogoutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const navigate = useNavigate();

  async function handleSignOut() {
    setLogoutError('');
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (error) {
      setLogoutError(error.message);
    } finally {
      setSigningOut(false);
    }
  }

  const firstName = user.name.trim().split(/\s+/)[0];

  return (
    <div className="min-h-screen bg-mist">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <BrandMark />
          <div className="flex items-center gap-3">
            {(user.role === 'ADMIN' || user.role === 'ADMIN_TESTER' || user.role === 'OFFICER') && (
              <Link className="button-secondary hidden sm:inline-flex" to="/admin-invitations">
                {user.role === 'OFFICER' ? 'Review Admin requests' : 'Replace Admin'}
              </Link>
            )}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-ink">{user.name}</p>
              <p className="text-xs text-slate-500">
                {user.role}{user.officerPosition ? ` · ${user.officerPosition.replaceAll('_', ' ')}` : ''}
              </p>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-full bg-teal/10 text-sm font-bold text-teal" aria-hidden="true">
              {firstName.charAt(0).toUpperCase()}
            </div>
            <button className="button-secondary" disabled={signingOut} onClick={handleSignOut} type="button">
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:py-14">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Secure staff workspace</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Good to see you, {firstName}.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Your sign-in is verified. This workspace is ready for the medicines register.
            </p>
          </div>
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            Signed in · {user.role}
          </div>
        </div>

        {logoutError && (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {logoutError}
          </div>
        )}

        <section className="mt-9 grid gap-5 md:grid-cols-3" aria-label="Session overview">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Account</p>
            <p className="mt-3 text-lg font-semibold text-ink">{user.name}</p>
            <p className="mt-1 break-all text-sm text-slate-600">{user.email}</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Access role</p>
            <p className="mt-3 text-lg font-semibold text-ink">{user.role}</p>
            <p className="mt-1 text-sm text-slate-600">Permissions are checked by the API.</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Session security</p>
            <p className="mt-3 text-lg font-semibold text-ink">{idleTimeoutMinutes} minute idle timeout</p>
            <p className="mt-1 text-sm text-slate-600">Sign out when leaving a shared device.</p>
          </article>
        </section>

        {(user.role === 'ADMIN' || user.role === 'ADMIN_TESTER' || user.role === 'OFFICER') && (
          <Link className="button-secondary mt-6 sm:hidden" to="/admin-invitations">
            {user.role === 'OFFICER' ? 'Review Admin requests' : 'Request Admin replacement'}
          </Link>
        )}

        <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-teal/10 text-teal" aria-hidden="true">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path d="M8 5h8m-9 4h10m-9 4h8m-9 4h10M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-ink">Medicines register</h2>
                <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">
                  The secure staff sign-in is ready. Register search and medicine records will be connected in the next build step.
                </p>
              </div>
            </div>
            <span className="w-fit rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600">
              Coming next
            </span>
          </div>
        </section>
      </main>
      <footer className="mx-auto max-w-7xl px-5 pb-8 text-xs text-slate-500 sm:px-8">
        Medicines Regulatory Authority · Eswatini
      </footer>
    </div>
  );
}
