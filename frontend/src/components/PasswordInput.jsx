export default function PasswordInput({
  autoComplete,
  className = '',
  id,
  maxLength,
  minLength,
  name,
  onChange,
  onToggle,
  required = false,
  value,
  visible = false,
}) {
  return (
    <div className="relative">
      <input
        autoComplete={autoComplete}
        className={`field-input pr-11 text-left ${className}`}
        id={id}
        maxLength={maxLength}
        minLength={minLength}
        name={name}
        onChange={onChange}
        required={required}
        type={visible ? 'text' : 'password'}
        value={value}
      />
      <button
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-ink"
        onClick={onToggle}
        type="button"
      >
        <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {visible ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M3 3l18 18M10.58 10.58a2 2 0 102.83 2.83M9.88 5.09A10.94 10.94 0 0112 4.5c5.25 0 8.5 5.5 8.5 5.5a16.8 16.8 0 01-3.04 3.78M6.61 6.61C4.17 8.15 3.5 10 3.5 10s3.25 5.5 8.5 5.5a10.94 10.94 0 003.2-.48" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M2.5 12s3.25-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.25 5.5-9.5 5.5S2.5 12 2.5 12z" />
          )}
          {!visible && <circle cx="12" cy="12" r="2.5" strokeWidth="1.8" />}
        </svg>
      </button>
    </div>
  );
}
