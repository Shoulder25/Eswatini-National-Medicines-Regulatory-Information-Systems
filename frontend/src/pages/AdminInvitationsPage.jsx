import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  createAdminInvitation,
  decideAdminInvitation,
  getAdminInvitations,
  reissueAdminSetupLink,
} from '../services/adminInvitations.js';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function OfficerDecisionCard({ invitation, onChanged }) {
  const [decision, setDecision] = useState('APPROVE');
  const [reason, setReason] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await decideAdminInvitation(invitation.id, { decision, reason, totpCode });
      await onChanged();
      setReason('');
      setTotpCode('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-5 grid gap-4 border-t border-slate-100 pt-5" onSubmit={submit}>
      <label className="field-label">
        Decision
        <select className="field-input" onChange={(event) => setDecision(event.target.value)} value={decision}>
          <option value="APPROVE">Approve and send setup link</option>
          <option value="REJECT">Reject invitation</option>
        </select>
      </label>
      <label className="field-label">
        Decision reason
        <textarea
          className="field-input min-h-24 resize-y"
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </label>
      <label className="field-label">
        Current time-based one-time password (TOTP)
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
      <button className="button-primary w-fit" disabled={busy} type="submit">
        {busy ? 'Recording decision…' : decision === 'APPROVE' ? 'Approve invitation' : 'Reject invitation'}
      </button>
    </form>
  );
}

function ReissueCard({ invitation, onChanged }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await reissueAdminSetupLink(invitation.id, { reason, totpCode });
      setOpen(false);
      setReason('');
      setTotpCode('');
      await onChanged();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="button-secondary mt-4" onClick={() => setOpen(true)} type="button">
        Reissue setup link
      </button>
    );
  }

  return (
    <form className="mt-4 grid gap-4 border-t border-slate-100 pt-4" onSubmit={submit}>
      <label className="field-label">
        Reason for reissue
        <textarea
          className="field-input min-h-20 resize-y"
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </label>
      <label className="field-label">
        Fresh authenticator code
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
      <div className="flex flex-wrap gap-3">
        <button className="button-primary" disabled={busy} type="submit">
          {busy ? 'Sending…' : 'Confirm reissue'}
        </button>
        <button className="button-secondary" disabled={busy} onClick={() => setOpen(false)} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}

function InvitationCard({ invitation, isOfficer, onChanged }) {
  const canReissue = invitation.status === 'APPROVED' && (
    invitation.delivery_status === 'FAILED' ||
    (invitation.setup_token_expires_at &&
      new Date(invitation.setup_token_expires_at).getTime() <= Date.now())
  );

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="font-semibold text-ink">{invitation.invitee_name}</h3>
          <p className="mt-1 break-all text-sm text-slate-600">{invitation.invitee_email}</p>
        </div>
        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {invitation.status.replaceAll('_', ' ')}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Requested</dt>
          <dd className="mt-1 font-medium text-slate-800">{formatDate(invitation.created_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Approval expires</dt>
          <dd className="mt-1 font-medium text-slate-800">{formatDate(invitation.approval_expires_at)}</dd>
        </div>
        {invitation.decided_at && (
          <div>
            <dt className="text-slate-500">Decision</dt>
            <dd className="mt-1 font-medium text-slate-800">
              {invitation.decision_officer_position?.replaceAll('_', ' ')} · {formatDate(invitation.decided_at)}
            </dd>
          </div>
        )}
        {invitation.delivery_status && (
          <div>
            <dt className="text-slate-500">Setup email</dt>
            <dd className="mt-1 font-medium text-slate-800">
              {invitation.delivery_status.replaceAll('_', ' ')}
              {invitation.email_sent_at ? ` · ${formatDate(invitation.email_sent_at)}` : ''}
            </dd>
          </div>
        )}
      </dl>
      {invitation.decision_reason && (
        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700">
          <span className="font-semibold">Reason: </span>{invitation.decision_reason}
        </p>
      )}
      {isOfficer && invitation.status === 'PENDING_APPROVAL' && (
        <OfficerDecisionCard invitation={invitation} onChanged={onChanged} />
      )}
      {isOfficer && canReissue && <ReissueCard invitation={invitation} onChanged={onChanged} />}
    </article>
  );
}

export default function AdminInvitationsPage() {
  const { user } = useAuth();
  const isOfficer = user.role === 'OFFICER' &&
    ['BOARD_CHAIR', 'BOARD_VICE_CHAIR'].includes(user.officerPosition);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setPageError('');
    try {
      const result = await getAdminInvitations();
      setRows(result || []);
    } catch (error) {
      setPageError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitInvite(event) {
    event.preventDefault();
    setFormError('');
    setNotice('');
    setSubmitting(true);
    try {
      await createAdminInvitation({ name, email });
      setName('');
      setEmail('');
      setNotice('Invitation submitted. It cannot be used until an independent Board Officer approves it.');
      await load();
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-mist px-5 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link className="text-sm font-semibold text-teal hover:underline" to="/dashboard">Back to dashboard</Link>
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal">Staff account governance</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Admin replacement</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            {isOfficer
              ? `Review replacement Admin requests as ${user.officerPosition.replaceAll('_', ' ')}. A fresh authenticator code and written reason are required.`
              : 'Submit a replacement request. A Board Officer must independently approve it before setup can begin.'}
          </p>
        </div>

        {!isOfficer && ['ADMIN', 'ADMIN_TESTER'].includes(user.role) && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-lg font-semibold text-ink">Invite a replacement Admin</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {user.role === 'ADMIN_TESTER' && 'Temporary test role: invitations are allowed, but only a Board Officer can approve them. '}
              Use the person’s official organization email. There is no public Admin sign-up; the email is checked against the configured exact-domain allowlist.
            </p>
            <form className="mt-6 grid gap-5 sm:grid-cols-2" onSubmit={submitInvite}>
              <label className="field-label">
                Full name
                <input className="field-input" maxLength={160} onChange={(event) => setName(event.target.value)} required value={name} />
              </label>
              <label className="field-label">
                Official email
                <input autoComplete="email" className="field-input" maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
              </label>
              {formError && <p className="text-sm text-rose-700 sm:col-span-2" role="alert">{formError}</p>}
              {notice && <p className="text-sm text-emerald-800 sm:col-span-2" role="status">{notice}</p>}
              <div className="sm:col-span-2">
                <button className="button-primary" disabled={submitting} type="submit">
                  {submitting ? 'Submitting…' : 'Submit for Board approval'}
                </button>
              </div>
            </form>
          </section>
        )}

        {pageError && (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {pageError}
          </div>
        )}
        <section className="mt-8" aria-labelledby="invitation-list-heading">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold text-ink" id="invitation-list-heading">
              {isOfficer ? 'Requests and decisions' : 'Your requests'}
            </h2>
            <button className="button-secondary" disabled={loading} onClick={load} type="button">Refresh</button>
          </div>
          {loading ? (
            <p className="rounded-2xl bg-white p-6 text-sm text-slate-600" role="status">Loading invitations…</p>
          ) : rows.length ? (
            <div className="grid gap-4">
              {rows.map((invitation) => (
                <InvitationCard
                  invitation={invitation}
                  isOfficer={isOfficer}
                  key={invitation.id}
                  onChanged={load}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
              No Admin replacement invitations yet.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
