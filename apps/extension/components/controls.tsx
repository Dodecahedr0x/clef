import { useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from './buttons';

const THUMB_SHADOW = 'shadow-[0_1px_2px_rgba(20,23,31,0.14)]';

// Arrow/Home/End move selection and focus among a group of options (WAI-ARIA radiogroup and tablist patterns).
function useRovingKeys<T extends string>(values: T[], value: T, onChange: (v: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = values.indexOf(value);
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % values.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + values.length) % values.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = values.length - 1;
    else return;
    e.preventDefault();
    const v = values[next];
    if (v === undefined) return;
    onChange(v);
    refs.current[next]?.focus();
  };
  return { refs, onKeyDown };
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'sm',
  fill = false,
  bordered = false,
}: {
  options: { value: T; label: ReactNode; ariaLabel?: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  fill?: boolean;
  bordered?: boolean;
}) {
  const { refs, onKeyDown } = useRovingKeys(options.map((o) => o.value), value, onChange);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`${fill ? 'grid' : 'inline-flex'} rounded-[10px] bg-surface-2 p-[3px] ${bordered ? 'border border-line' : ''}`}
      style={fill ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.ariaLabel}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] border-0 text-[12px] ${size === 'md' ? 'h-9 px-3' : 'h-[30px] px-[9px]'} ${on ? `bg-surface font-semibold text-ink ${THUMB_SHADOW}` : 'bg-transparent text-muted hover:text-ink'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, ariaLabel }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; ariaLabel: string }) {
  const { refs, onKeyDown } = useRovingKeys(tabs.map((t) => t.id), value, onChange);
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex gap-1 border-b border-line-soft">
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={onKeyDown}
            className={`-mb-px h-10 border-0 border-b-2 bg-transparent px-2.5 text-[14px] ${on ? 'border-primary font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chips<T extends string>({ chips, value, onChange, ariaLabel }: { chips: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const on = c.id === value;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(c.id)}
            className={`h-8 rounded-full px-3 text-[12px] ${on ? 'border border-transparent bg-ink font-semibold text-white' : 'border border-line bg-surface text-ink hover:border-line-strong'}`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ label, description, checked, onChange }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-1.5 text-[14px]">
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{label}</span>
        {description && <span className="text-[12px] text-muted">{description}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="m-0 size-5 flex-none accent-primary" />
    </label>
  );
}

/** `hint`: a standing note under the field (a rule to meet); an error replaces it. */
type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: ReactNode; trailing?: ReactNode; mono?: boolean };

export function TextField({ label, error, hint, trailing, mono = false, id, className = '', ...props }: FieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={inputId} className="text-[12px] text-muted">{label}</label>
      <div
        className={`flex h-12 items-center rounded-[12px] border bg-surface pl-3.5 ${trailing ? 'pr-1' : 'pr-3.5'} ${error ? 'border-danger' : 'border-field-line focus-within:border-primary'}`}
      >
        <input
          id={inputId}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={`min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint ${mono ? 'font-mono' : ''}`}
          {...props}
        />
        {trailing}
      </div>
      {error ? (
        <span id={errorId} className="text-[12px] text-danger-text">{error}</span>
      ) : (
        hint && <span id={hintId} className="text-[12px] text-muted">{hint}</span>
      )}
    </div>
  );
}

export function PasswordField({ label, error, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null; hint?: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      label={label}
      error={error}
      hint={hint}
      type={shown ? 'text' : 'password'}
      style={shown ? undefined : { letterSpacing: '0.15em' }}
      trailing={<IconButton size={40} label={shown ? 'Hide password' : 'Show password'} icon={shown ? 'eye-off' : 'eye'} onClick={() => setShown((s) => !s)} />}
    />
  );
}
