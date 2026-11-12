import { QRCodeSVG } from 'qrcode.react';

export default function AuthenticatorEnrollment({ secret, uri, copied, onCopy }) {
  if (!secret || !uri) return null;

  return (
    <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
      <div className="w-fit rounded-xl bg-white p-3" role="img" aria-label="Authenticator setup QR code">
        <QRCodeSVG value={uri} size={176} level="M" includeMargin />
      </div>
      <div className="rounded-xl bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Authenticator setup key</p>
        <code className="mt-2 block break-all text-sm font-bold tracking-wider text-ink">{secret}</code>
        <button className="button-secondary mt-3" onClick={onCopy} type="button">
          {copied ? 'Copied' : 'Copy key'}
        </button>
      </div>
      <details className="text-sm sm:col-span-2">
        <summary className="cursor-pointer font-semibold text-teal">Manual setup details</summary>
        <code className="mt-2 block break-all rounded-lg bg-white p-3 text-xs text-slate-700">{uri}</code>
      </details>
    </div>
  );
}
