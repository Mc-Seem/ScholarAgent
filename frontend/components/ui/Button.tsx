/**
 * Button Component
 *
 * Reusable button component with consistent styling and variants.
 *
 * Usage:
 * <Button variant="primary" size="md" onClick={handleClick}>
 *   Click me
 * </Button>
 *
 * <Button variant="ghost" icon={Edit2} />
 */

import { ButtonHTMLAttributes, ReactNode } from 'react';
import { LucideIcon, Loader2 } from 'lucide-react';
import { componentStyles } from '../../lib/design-system';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'icon';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading = false,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  // Build class names
  let baseClass = '';

  if (variant === 'icon') {
    baseClass = componentStyles.button.icon;
  } else if (variant === 'ghost') {
    baseClass = componentStyles.button.ghost;
  } else if (size === 'sm') {
    baseClass = componentStyles.button.small;
    if (variant === 'primary') {
      baseClass += ' text-white bg-indigo-600 hover:bg-indigo-700';
    } else if (variant === 'secondary') {
      baseClass += ' text-slate-700 bg-white border border-slate-300 hover:bg-slate-50';
    }
  } else {
    baseClass = variant === 'primary' ? componentStyles.button.primary : componentStyles.button.secondary;
  }

  const combinedClass = className ? `${baseClass} ${className}` : baseClass;

  // Icon size based on button size
  const iconSize = size === 'sm' ? 14 : 16;

  return (
    <button
      className={combinedClass}
      disabled={disabled || loading}
      {...props}
    >
      {loading && children ? (
        <>
          <Loader2 size={iconSize} className="animate-spin" />
          <span>{children}</span>
        </>
      ) : loading ? (
        <Loader2 size={iconSize} className="animate-spin" />
      ) : Icon && children ? (
        <>
          <Icon size={iconSize} />
          <span>{children}</span>
        </>
      ) : Icon ? (
        <Icon size={iconSize} />
      ) : (
        children
      )}
    </button>
  );
}

/**
 * IconButton - A specialized button for icon-only actions
 */
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label?: string; // For accessibility
  variant?: 'default' | 'destructive' | 'primary';
}

export function IconButton({
  icon: Icon,
  label,
  variant = 'default',
  className,
  ...props
}: IconButtonProps) {
  const variantClasses = {
    default: 'text-slate-500 hover:text-slate-700',
    destructive: 'text-slate-500 hover:text-red-600',
    primary: 'text-indigo-600 hover:text-indigo-700',
  };

  const baseClass = `p-1 rounded transition-colors ${variantClasses[variant]}`;
  const combinedClass = className ? `${baseClass} ${className}` : baseClass;

  return (
    <button
      className={combinedClass}
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon size={14} />
    </button>
  );
}
