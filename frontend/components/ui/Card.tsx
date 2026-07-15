/**
 * Card Component
 *
 * Reusable card component with consistent styling.
 * Supports selected/highlighted state and custom content.
 *
 * Usage:
 * <Card selected={isSelected}>
 *   <div>Your content here</div>
 * </Card>
 */

import { ReactNode } from 'react';
import { componentStyles } from '../../lib/design-system';

interface CardProps {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

export function Card({ children, selected = false, onClick, className }: CardProps) {
  const baseClass = selected ? componentStyles.card.selected : componentStyles.card.default;
  const combinedClass = className ? `${baseClass} ${className}` : baseClass;

  return (
    <div className={combinedClass} onClick={onClick}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  children: ReactNode;
  actions?: ReactNode;
}

export function CardHeader({ children, actions }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex-1 min-w-0">{children}</div>
      {actions && <div className="flex items-center gap-1 flex-shrink-0">{actions}</div>}
    </div>
  );
}

interface CardContentProps {
  children: ReactNode;
  expanded?: boolean;
}

export function CardContent({ children, expanded = true }: CardContentProps) {
  if (!expanded) return null;
  return <div className="border-t border-slate-200 pt-2">{children}</div>;
}

interface CardActionsProps {
  children: ReactNode;
}

export function CardActions({ children }: CardActionsProps) {
  return (
    <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
      {children}
    </div>
  );
}
