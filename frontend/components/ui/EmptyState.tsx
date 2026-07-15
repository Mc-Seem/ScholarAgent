/**
 * EmptyState Component
 *
 * Reusable component for displaying empty states across the application.
 * Used in sidebars, lists, and other containers when there's no content.
 *
 * Usage:
 * <EmptyState
 *   icon={FileText}
 *   title="No items found"
 *   description="Try adding some items to get started"
 *   variant="sidebar" // or "card"
 * />
 */

import { LucideIcon } from 'lucide-react';
import { colors, textStyles, spacing, borders } from '../../lib/design-system';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  variant?: 'sidebar' | 'card';
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  variant = 'sidebar',
  action,
}: EmptyStateProps) {
  // Both variants use the same centered layout now
  // The only difference is 'card' adds a background card container
  const innerContent = (
    <>
      <Icon size={32} className="text-slate-300" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-slate-500">{title}</p>
        {description && (
          <p className="text-xs text-slate-400">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </>
  );

  if (variant === 'card') {
    return (
      <div className="bg-slate-50 rounded-lg border border-slate-200 p-6">
        <div className="flex flex-col items-center justify-center text-center gap-3">
          {innerContent}
        </div>
      </div>
    );
  }

  // Sidebar variant - centered in full height
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-3">
      {innerContent}
    </div>
  );
}
