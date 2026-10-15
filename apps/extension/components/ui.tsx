import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({ variant = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const styles = {
    primary: 'bg-violet-500 text-white hover:bg-violet-400 disabled:bg-violet-900 disabled:text-violet-300',
    secondary: 'bg-gray-800 text-gray-100 hover:bg-gray-700 disabled:opacity-50',
    danger: 'bg-red-600 text-white hover:bg-red-500 disabled:opacity-50',
  }[variant];
  return <button className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${styles} ${className}`} {...props} />;
}

export function Field({ label, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-gray-400">{label}</span>
      <input
        className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100 outline-none focus:border-violet-400"
        autoComplete="off"
        spellCheck={false}
        {...props}
      />
      {error && <span className="block text-red-400">{error}</span>}
    </label>
  );
}

export function Screen({ title, children, onBack }: { title: string; children: ReactNode; onBack?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <header className="flex items-center gap-2">
        {onBack && (
          <button className="text-gray-400 hover:text-gray-100" onClick={onBack} aria-label="Back">
            &larr;
          </button>
        )}
        <h1 className="text-lg font-semibold">{title}</h1>
      </header>
      {children}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="text-sm text-red-400">{error}</p> : null;
}
