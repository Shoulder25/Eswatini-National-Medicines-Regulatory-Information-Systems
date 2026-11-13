import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { PERMISSION_CODES } from '../config/roles.js';

function SideNavigation({ open, onToggle, permissions, onSignOut, signingOut }) {
  const mayInviteAdmin = permissions.includes(PERMISSION_CODES.INVITE_ADMIN);
  const mayApproveAdmin = permissions.includes(PERMISSION_CODES.APPROVE_ADMIN_REPLACEMENT);
  const mayStartReplacement = permissions.includes(PERMISSION_CODES.START_REPLACEMENT);
  const mayApproveReplacement = permissions.includes(PERMISSION_CODES.APPROVE_REPLACEMENT);
  const mayManageRegistration = permissions.includes(PERMISSION_CODES.MANAGE_REGISTRATION);
  const mayEvaluateRegistration = permissions.includes(PERMISSION_CODES.EVALUATE_REGISTRATION);
  const mayManageEstablishments = permissions.includes(PERMISSION_CODES.MANAGE_ESTABLISHMENT_LICENSING);
  const mayInspectEstablishments = permissions.includes(PERMISSION_CODES.CONDUCT_INSPECTIONS);
  const mayManageImportExport = permissions.includes(PERMISSION_CODES.MANAGE_IMPORT_EXPORT_PERMITS);
  const mayManageControlled = permissions.includes(PERMISSION_CODES.MANAGE_CONTROLLED_SUBSTANCES);

  return (
    <>
      {open && <button className="fixed inset-0 z-30 bg-ink/30 lg:hidden" aria-label="Close navigation" onClick={onToggle} type="button" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-white px-5 py-7 shadow-xl transition-transform duration-300 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="grid place-items-center" aria-label="eNMRIS">
          <img alt="eNMRIS" className="h-24 w-full rounded-xl object-contain" src="/logo.jpg" />
        </div>
        <nav className="mt-auto space-y-2" aria-label="Main navigation">
          <Link className="side-nav-link" to="/dashboard">Dashboard</Link>
          <a className="side-nav-link" href="#account" onClick={onToggle}>Account</a>
          {mayInviteAdmin && (
            <Link className="side-nav-link" to="/admin-invitations">
              Create Admin account
            </Link>
          )}
          {mayApproveAdmin && !mayInviteAdmin && (
            <Link className="side-nav-link" to="/admin-invitations">
              Review Admin requests
            </Link>
          )}
          {mayStartReplacement && (
            <Link className="side-nav-link" to="/officer-replacements">
              Create Staff account
            </Link>
          )}
          {mayApproveReplacement && !mayStartReplacement && (
            <Link className="side-nav-link" to="/officer-replacements">Review Staff requests</Link>
          )}
          {(mayManageRegistration || mayEvaluateRegistration) && (
            <Link className="side-nav-link" to="/medicine-registrations">Medicine registration</Link>
          )}
          {(mayManageEstablishments || mayInspectEstablishments) && (
            <Link className="side-nav-link" to="/establishment-licensing">Establishment licensing</Link>
          )}
          {(mayManageImportExport || mayManageControlled) && (
            <Link className="side-nav-link" to="/import-export-controlled">Import/export control</Link>
          )}
          {(mayInviteAdmin || mayApproveAdmin || mayStartReplacement) && (
            <Link className="side-nav-link" to="/account-recovery">Account recovery</Link>
          )}
          <button className="side-nav-link w-full text-left" disabled={signingOut} onClick={onSignOut} type="button">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </nav>
      </aside>
      <button
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        className={`fixed top-1/2 z-50 grid h-12 w-8 -translate-y-1/2 place-items-center rounded-r-xl bg-ink text-white shadow-lg transition-[left] duration-300 ease-out ${open ? 'left-64' : 'left-0'}`}
        onClick={onToggle}
        type="button"
      >
        <span className={`text-xl transition-transform duration-300 ${open ? '' : 'rotate-180'}`} aria-hidden="true">‹</span>
      </button>
    </>
  );
}

export default function DashboardPage() {
  const { user, idleTimeoutMinutes, signOut } = useAuth();
  const [logoutError, setLogoutError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [menuOpen, setMenuOpen] = useState(true);
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
  const permissions = user.permissions || [];
  const displayRole = user.roleLabel || user.roleCode || user.role;
  const displayPosition = user.officerPositionLabel;
  const displayFunctionalRole = user.functionalRoleLabel;

  return (
    <div className="min-h-screen bg-mist">
      <SideNavigation
        onSignOut={handleSignOut}
        onToggle={() => setMenuOpen((current) => !current)}
        open={menuOpen}
        permissions={permissions}
        signingOut={signingOut}
      />

      <div className={`min-h-screen transition-[margin] duration-300 ease-out ${menuOpen ? 'lg:ml-64' : ''}`}>
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl items-center justify-end gap-3 px-5 py-4 sm:px-8">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-ink">{user.name}</p>
              <p className="text-xs text-slate-500">
                {displayRole}
                {displayPosition ? ` · ${displayPosition}` : ''}
                {displayFunctionalRole ? ` · ${displayFunctionalRole}` : ''}
              </p>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-full bg-teal/10 text-sm font-bold text-teal" aria-hidden="true">
              {firstName.charAt(0).toUpperCase()}
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
              Signed in · {displayRole}
            </div>
          </div>

          {logoutError && (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
              {logoutError}
            </div>
          )}

          <section className="mt-9 grid gap-5 md:grid-cols-3" aria-label="Session overview">
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="account">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Account</p>
              <p className="mt-3 text-lg font-semibold text-ink">{user.name}</p>
              <p className="mt-1 break-all text-sm text-slate-600">{user.email}</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Access role</p>
              <p className="mt-3 text-lg font-semibold text-ink">{displayRole}</p>
              <p className="mt-1 text-sm text-slate-600">Permissions are checked by the API.</p>
            </article>
            <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Session security</p>
              <p className="mt-3 text-lg font-semibold text-ink">{idleTimeoutMinutes} minute idle timeout</p>
              <p className="mt-1 text-sm text-slate-600">Sign out when leaving a shared device.</p>
            </article>
          </section>
        </main>
        <footer className="mx-auto max-w-7xl px-5 pb-8 text-xs text-slate-500 sm:px-8">
          Medicines Regulatory Authority · Eswatini
        </footer>
      </div>
    </div>
  );
}
