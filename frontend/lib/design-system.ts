/**
 * Centralized Design System
 *
 * This file contains all reusable design tokens (colors, spacing, etc.) and
 * CSS class utilities used throughout the application.
 *
 * Usage:
 * import { colors, spacing, textStyles } from '@/lib/design-system';
 */

// ============================================================================
// COLOR PALETTE
// ============================================================================

export const colors = {
  // Primary brand color (indigo)
  primary: {
    50: 'bg-indigo-50',
    100: 'bg-indigo-100',
    300: 'bg-indigo-300',
    500: 'bg-indigo-500',
    600: 'bg-indigo-600',
    700: 'bg-indigo-700',
    text: {
      50: 'text-indigo-50',
      100: 'text-indigo-100',
      500: 'text-indigo-500',
      600: 'text-indigo-600',
      700: 'text-indigo-700',
    },
    border: {
      300: 'border-indigo-300',
      500: 'border-indigo-500',
      600: 'border-indigo-600',
    },
    hover: {
      bg: 'hover:bg-indigo-700',
      text: 'hover:text-indigo-600',
    },
  },

  // Neutral colors (slate)
  neutral: {
    50: 'bg-slate-50',
    100: 'bg-slate-100',
    200: 'bg-slate-200',
    300: 'bg-slate-300',
    400: 'bg-slate-400',
    500: 'bg-slate-500',
    600: 'bg-slate-600',
    700: 'bg-slate-700',
    900: 'bg-slate-900',
    text: {
      300: 'text-slate-300',
      400: 'text-slate-400',
      500: 'text-slate-500',
      600: 'text-slate-600',
      700: 'text-slate-700',
      900: 'text-slate-900',
    },
    border: {
      200: 'border-slate-200',
      300: 'border-slate-300',
    },
    hover: {
      bg: {
        50: 'hover:bg-slate-50',
        100: 'hover:bg-slate-100',
        200: 'hover:bg-slate-200',
      },
      text: 'hover:text-slate-600',
    },
  },

  // White background
  white: 'bg-white',

  // Entity type colors
  entity: {
    formula: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      icon: 'text-amber-500',
      border: 'border-amber-300',
      hex: '#f59e0b',
    },
    symbol: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      icon: 'text-blue-500',
      border: 'border-blue-300',
      // Raw hex for ReactFlow/canvas usage
      hex: '#3b82f6',
    },
    definition: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      icon: 'text-emerald-500',
      border: 'border-emerald-300',
      hex: '#10b981',
    },
    theorem: {
      bg: 'bg-violet-50',
      text: 'text-violet-700',
      icon: 'text-violet-500',
      border: 'border-violet-300',
      hex: '#8b5cf6',
    },
  },

  // Relationship/edge colors
  relationship: {
    uses: {
      text: 'text-indigo-600',
      hex: '#6366f1',
    },
    depends_on: {
      text: 'text-amber-600',
      hex: '#f59e0b',
    },
    defines: {
      text: 'text-emerald-600',
      hex: '#10b981',
    },
    extends: {
      text: 'text-violet-600',
      hex: '#8b5cf6',
    },
    mentions: {
      text: 'text-slate-500',
      hex: '#94a3b8',
    },
  },

  // Destructive/error (red)
  destructive: {
    50: 'bg-red-50',
    600: 'bg-red-600',
    text: {
      600: 'text-red-600',
    },
    hover: {
      text: 'hover:text-red-600',
      bg: 'hover:bg-red-50',
    },
  },

  // Success/positive (green)
  success: {
    text: 'text-green-600',
  },
} as const;

// ============================================================================
// SHARED TERM HIGHLIGHTING
// ============================================================================

/**
 * Raw hex colors for shared-term highlighting: when two papers of a reading
 * set are read side by side, every group of aligned terms gets one of these
 * colors in both panes. Consecutive entries are far apart in hue so the
 * groups a reader compares most often stay distinguishable.
 */
export const sharedTermPalette = [
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1', // indigo
] as const;

// ============================================================================
// TYPOGRAPHY
// ============================================================================

export const textStyles = {
  // Headings
  h1: 'text-xl font-bold text-slate-900',
  h2: 'text-lg font-semibold text-slate-900',
  h3: 'text-sm font-semibold text-slate-700',

  // Body text
  body: 'text-sm text-slate-700',
  bodySmall: 'text-xs text-slate-600',
  bodyMuted: 'text-sm text-slate-600',

  // Labels and captions
  label: 'text-xs font-medium text-slate-600',
  caption: 'text-xs text-slate-500',
  captionMuted: 'text-xs text-slate-400',

  // Section headers (uppercase, tracking-wide)
  sectionHeader: 'text-xs font-semibold text-slate-500 uppercase tracking-wider',

  // Interactive text
  link: 'text-sm text-indigo-600 hover:text-indigo-700 cursor-pointer',
} as const;

// ============================================================================
// SPACING & SIZING
// ============================================================================

export const spacing = {
  // Padding
  padding: {
    xs: 'p-1',
    sm: 'p-2',
    md: 'p-3',
    lg: 'p-4',
    xl: 'p-6',
  },
  paddingX: {
    sm: 'px-2',
    md: 'px-3',
    lg: 'px-4',
    xl: 'px-6',
  },
  paddingY: {
    sm: 'py-1',
    md: 'py-2',
    lg: 'py-3',
    xl: 'py-4',
  },

  // Margins
  gap: {
    xs: 'gap-1',
    sm: 'gap-2',
    md: 'gap-3',
    lg: 'gap-4',
  },

  // Spacing between components
  space: {
    xs: 'space-y-1',
    sm: 'space-y-2',
    md: 'space-y-3',
    lg: 'space-y-4',
  },
} as const;

// ============================================================================
// BORDER & RADIUS
// ============================================================================

export const borders = {
  // Border width
  default: 'border',
  none: 'border-0',

  // Border radius
  radius: {
    sm: 'rounded',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  },

  // Common border colors (refer to colors object for more)
  color: {
    default: 'border-slate-200',
    hover: 'hover:border-slate-300',
    primary: 'border-indigo-300',
  },
} as const;

// ============================================================================
// SHADOWS
// ============================================================================

export const shadows = {
  sm: 'shadow-sm',
  md: 'shadow',
  lg: 'shadow-lg',
  xl: 'shadow-xl',
  '2xl': 'shadow-2xl',
} as const;

// ============================================================================
// TRANSITIONS
// ============================================================================

export const transitions = {
  colors: 'transition-colors',
  all: 'transition-all',
  fast: 'transition-all duration-150',
} as const;

// ============================================================================
// COMMON COMPONENT STYLES
// ============================================================================

/**
 * Pre-composed styles for common UI patterns
 */
export const componentStyles = {
  // Buttons
  button: {
    // Primary button (indigo background)
    primary: `
      flex items-center gap-2
      px-4 py-2 text-sm font-medium text-white
      bg-indigo-600 hover:bg-indigo-700
      rounded-lg transition-colors
      disabled:opacity-50 disabled:cursor-not-allowed
    `.trim().replace(/\s+/g, ' '),

    // Secondary button (white with border)
    secondary: `
      flex items-center gap-2
      px-4 py-2 text-sm font-medium text-slate-700
      bg-white border border-slate-300
      rounded-lg hover:bg-slate-50
      transition-colors
      disabled:opacity-50 disabled:cursor-not-allowed
    `.trim().replace(/\s+/g, ' '),

    // Small button
    small: `
      flex items-center gap-1.5
      px-3 py-1.5 text-xs font-medium
      rounded-lg transition-colors
      disabled:opacity-50 disabled:cursor-not-allowed
    `.trim().replace(/\s+/g, ' '),

    // Icon button
    icon: `
      p-1 rounded hover:bg-slate-100 transition-colors
    `.trim().replace(/\s+/g, ' '),

    // Ghost/text button
    ghost: `
      flex items-center gap-1.5
      px-3 py-1.5 text-xs font-medium
      rounded-lg hover:bg-slate-50 transition-colors
      disabled:opacity-50 disabled:cursor-not-allowed
    `.trim().replace(/\s+/g, ' '),
  },

  // Cards
  card: {
    // Standard card
    default: `
      bg-white rounded-lg border border-slate-200
      hover:border-slate-300 transition-colors
    `.trim().replace(/\s+/g, ' '),

    // Highlighted/selected card
    selected: `
      bg-white rounded-lg border border-indigo-300 shadow-sm
    `.trim().replace(/\s+/g, ' '),

    // Card with padding
    padded: `
      bg-white rounded-lg border border-slate-200 p-3
      hover:border-slate-300 transition-colors
    `.trim().replace(/\s+/g, ' '),
  },

  // Input fields
  input: {
    default: `
      w-full text-sm px-3 py-2
      border border-slate-300 rounded-md
      bg-white text-slate-900
      placeholder:text-slate-400
      focus:outline-none focus:ring-2 focus:ring-indigo-500
    `.trim().replace(/\s+/g, ' '),

    textarea: `
      w-full text-sm px-3 py-2
      border border-slate-300 rounded-md
      bg-white text-slate-900
      placeholder:text-slate-400
      focus:outline-none focus:ring-2 focus:ring-indigo-500
      resize-none
    `.trim().replace(/\s+/g, ' '),
  },

  // Modal/dialog
  dialog: {
    overlay: 'fixed inset-0 z-50 flex items-center justify-center bg-black/50',
    container: 'bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden',
    header: 'flex items-center justify-between px-6 py-4 border-b border-slate-200',
    body: 'flex-1 overflow-y-auto px-6 py-4',
    footer: 'flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50',
  },

  // Badges/tags
  badge: {
    default: 'text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full',
    primary: 'text-xs text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full',
  },

  // Section dividers
  divider: {
    default: 'border-t border-slate-200',
  },
} as const;
