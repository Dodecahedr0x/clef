import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './icons';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger-outline' | 'dark';
type Size = 'lg' | 'md' | 'sm' | 'xs';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-primary text-white border border-transparent font-semibold hover:brightness-110',
  secondary: 'bg-surface text-ink border border-line-strong font-medium hover:bg-surface-4',
  ghost: 'bg-transparent text-ink border border-transparent font-medium hover:bg-surface-2',
  'danger-outline': 'bg-surface text-danger-text border border-danger-line font-semibold hover:bg-danger-bg',
  dark: 'bg-ink text-white border border-transparent font-semibold hover:bg-ink-2',
};

const SIZE: Record<Size, string> = {
  lg: 'h-12 px-4 gap-2 text-sm rounded-2xl',
  md: 'h-11 px-4 gap-2 text-sm rounded-2xl',
  sm: 'h-9 px-3 gap-1.5 text-xs rounded-xl',
  xs: 'h-[30px] px-2.5 gap-1.5 text-xs rounded-lg',
};

const DISABLED = 'disabled:bg-surface-2 disabled:text-faint disabled:border-dashed disabled:border-line-strong disabled:font-medium disabled:cursor-not-allowed disabled:hover:brightness-100';

export function Button({
  variant = 'primary',
  size = 'lg',
  block = false,
  icon,
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; block?: boolean; icon?: IconName }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center whitespace-nowrap transition-colors ${VARIANT[variant]} ${SIZE[size]} ${DISABLED} ${block ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} size={size === 'lg' || size === 'md' ? 16 : 14} />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  size = 44,
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: IconName; size?: 40 | 44 }) {
  return (
    <button
      type={type}
      aria-label={label}
      className={`inline-flex flex-none items-center justify-center rounded-xl border-0 bg-transparent hover:bg-surface-2 ${/\btext-/.test(className) ? '' : 'text-muted hover:text-ink'} disabled:opacity-50 ${size === 44 ? 'size-11' : 'size-10'} ${className}`}
      {...props}
    >
      <Icon name={icon} size={20} />
    </button>
  );
}
