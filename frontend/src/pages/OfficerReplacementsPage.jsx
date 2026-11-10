import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { BOARD_POSITION_CODES, PERMISSION_CODES, ROLE_CODES } from '../config/roles.js';
import {
  createOfficerReplacement,
  decideOfficerReplacement,
  getOfficerReplacementRequests,
  reissueOfficerSetupLink,
} from '../services/officerReplacements.js';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function DecisionCard({ replacement, onChanged }) {
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
      await decideOfficerReplacement(replacement.id, { decision, reason, totpCode });
      setReason('');
      setTotpCode('');
      await onChanged();
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
          <option value="REJECT">Reject replacement request</option>
        </select>
      </label>
      <label className="field-label">
        Reason
        <textarea className="field-input min-h-24 resize-y" maxLength={2000} onChange={(event) => setReason(event.target.value)} required value={reason} />
      </label>
      <label className="field-label">
        Fresh authenticator code
        <input autoComplete="one-time-code" className="field-input" inputMode="numeric" maxLength={6} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" required value={totpCode} />
      </label>
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      <button className="button-primary w-fit" disabled={busy} type="submit">
        {busy ? 'Recording decision…' : decision === 'APPROVE' ? 'Approve replacement' : 'Reject replacement'}
      </button>
    </form>
  );
}

function ReissueCard({ replacement, onChanged }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const expired = replacement.setup_token_expires_at &&
    new Date(replacement.setup_token_expires_at).getTime() <= Date.now();

  async function submit(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await reissueOfficerSetupLink(replacement.id, { reason, totpCode });
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

  if (replacement.status !== 'APPROVED' ||
      (replacement.delivery_status !== 'FAILED' && !expired)) return null;
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
        <textarea className="field-input min-h-20 resize-y" maxLength={1000} onChange={(event) => setReason(event.target.value)} required value={reason} />
      </label>
      <label className="field-label">
        Fresh authenticator code
        <input autoComplete="one-time-code" className="field-input" inputMode="numeric" maxLength={6} onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} pattern="[0-9]{6}" required value={totpCode} />
      </label>
      {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button className="button-primary" disabled={busy} type="submit">{busy ? 'Sending…' : 'Confirm reissue'}</button>
        <button className="button-secondary" disabled={busy} onClick={() => setOpen(false)} type="button">Cancel</button>
      </div>
    </form>
  );
}

function ReplacementCard({ replacement, isOfficer, userId, onChanged }) {
  const mayDecide = isOfficer &&
    replacement.status === 'PENDING_APPROVAL' &&
    replacement.continuing_officer_user_id === userId;
  const mayReissue = isOfficer &&
    replacement.continuing_officer_user_id === userId;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h3 className="font-semibold text-ink">{replacement.incoming_name}</h3>
          <p className="mt-1 break-all text-sm text-slate-600">{replacement.incoming_email}</p>
        </div>
        <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
          {replacement.status.replaceAll('_', ' ')}
        </span>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">Position being replaced</dt><dd className="mt-1 font-medium text-slate-800">{replacement.outgoing_position_label || replacement.outgoing_position}</dd></div>
        <div><dt className="text-slate-500">Requested</dt><dd className="mt-1 font-medium text-slate-800">{formatDate(replacement.created_at)}</dd></div>
        {replacement.approval_expires_at && <div><dt className="text-slate-500">Approval expires</dt><dd className="mt-1 font-medium text-slate-800">{formatDate(replacement.approval_expires_at)}</dd></div>}
        {replacement.decided_at && <div><dt className="text-slate-500">Decision</dt><dd className="mt-1 font-medium text-slate-800">{replacement.decision_officer_position_label || replacement.decision_officer_position} · {formatDate(replacement.decided_at)}</dd></div>}
        {replacement.delivery_status && <div><dt className="text-slate-500">Setup email</dt><dd className="mt-1 font-medium text-slate-800">{replacement.delivery_status.replaceAll('_', ' ')}{replacement.email_sent_at ? ` · ${formatDate(replacement.email_sent_at)}` : ''}</dd></div>}
        {replacement.test_sign_in_at && <div><dt className="text-slate-500">Successful sign-in</dt><dd className="mt-1 font-medium text-slate-800">{formatDate(replacement.test_sign_in_at)}</dd></div>}
      </dl>
      {replacement.decision_reason && <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-700"><span className="font-semibold">Reason: </span>{replacement.decision_reason}</p>}
      {mayDecide && <DecisionCard replacement={replacement} onChanged={onChanged} />}
      {mayReissue && <ReissueCard replacement={replacement} onChanged={onChanged} />}
    </article>
  );
}

export default function OfficerReplacementsPage() {
  const { user } = useAuth();
  const permissions = user.permissions || [];
  const mayStartReplacement = permissions.includes(PERMISSION_CODES.START_REPLACEMENT);
  const isOfficer = user.roleCode === ROLE_CODES.OFFICER &&
    BOARD_POSITION_CODES.includes(user.officerPosition) &&
    permissions.includes(PERMISSION_CODES.APPROVE_REPLACEMENT);
  const [rows, setRows] = useState([]);
  const [boardPositions, setBoardPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [formError, setFormError] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [outgoingPosition, setOutgoingPosition] = useState(ROLE_CODES.BOARD_CHAIR);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setPageError('');
    try {
      const result = await getOfficerReplacementRequests();
      setRows(result.requests || []);
      setBoardPositions(result.boardPositions || []);
    } catch (error) {
      setPageError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function submitRequest(event) {
    event.preventDefault();
    setFormError('');
    setNotice('');
    setSubmitting(true);
    try {
      const result = await createOfficerReplacement({ outgoingPosition, incomingName: name, incomingEmail: email });
      setName('');
      setEmail('');
      setNotice(`Request submitted. Officer notice delivery: ${result.noticeDelivery.map((item) => `${item.positionLabel || item.position} ${item.status.toLowerCase()}`).join(', ')}.`);
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
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Board Officer replacement</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            {mayStartReplacement
              ? 'Submit a replacement request. The remaining, non-outgoing Board Officer must independently approve or reject it with a fresh authenticator code and written reason.'
              : `Review requests assigned to you as ${user.officerPositionLabel || user.officerPosition}. The outgoing Officer remains active until the incoming Officer enrolls an authenticator and signs in successfully.`}
          </p>
        </div>

        {mayStartReplacement && (
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-lg font-semibold text-ink">Start a replacement request</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">The incoming person’s email must match the configured allowed-domain policy. If no continuing Officer can approve, use the trusted local emergency bootstrap process.</p>
            <form className="mt-6 grid gap-5 sm:grid-cols-2" onSubmit={submitRequest}>
              <label className="field-label">
                Outgoing position
                <select className="field-input" onChange={(event) => setOutgoingPosition(event.target.value)} value={outgoingPosition}>
                  {boardPositions.filter((position) => BOARD_POSITION_CODES.includes(position.code)).map((position) => (
                    <option key={position.code} value={position.code}>{position.label}</option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Incoming Officer full name
                <input autoComplete="name" className="field-input" maxLength={160} onChange={(event) => setName(event.target.value)} required value={name} />
              </label>
              <label className="field-label sm:col-span-2">
                Incoming Officer email
                <input autoComplete="email" className="field-input" maxLength={254} onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
              </label>
              {formError && <p className="text-sm text-rose-700 sm:col-span-2" role="alert">{formError}</p>}
              {notice && <p className="text-sm text-emerald-800 sm:col-span-2" role="status">{notice}</p>}
              <button className="button-primary w-fit sm:col-span-2" disabled={submitting} type="submit">
                {submitting ? 'Submitting request…' : 'Submit replacement request'}
              </button>
            </form>
          </section>
        )}

        <section className="mt-9">
          <h2 className="text-xl font-semibold text-ink">{mayStartReplacement && !isOfficer ? 'Your requests' : 'Replacement requests'}</h2>
          {pageError && <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{pageError}</p>}
          {loading ? (
            <p className="mt-5 text-sm text-slate-600" role="status">Loading replacement requests…</p>
          ) : !rows.length ? (
            <p className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No Officer replacement requests are available.</p>
          ) : (
            <div className="mt-5 grid gap-4">
              {rows.map((replacement) => (
                <ReplacementCard key={replacement.id} replacement={replacement} isOfficer={isOfficer} userId={user.id} onChanged={load} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
