# Design System

Centralized design system for the Scholar Agent frontend. Ensures visual consistency and prevents common issues like unreadable text (light gray on light gray), inconsistent button styles, and broken entity coloring.

## Source Files

- `frontend/lib/design-system.ts` — Design tokens (colors, typography, spacing, component styles)
- `frontend/lib/colors.ts` — Legacy color constants (`TEXT`, `BG`, `BORDER`, `INPUT`, `BUTTON`)
- `frontend/components/ui/` — Reusable UI components (Button, Card, EmptyState, CollapsibleSection, TreeView)

---

## 1. Design Tokens

Import from `@/lib/design-system`:

```typescript
import { colors, textStyles, componentStyles } from '@/lib/design-system';
```

### Primary Colors (Indigo)

Used for primary actions, selections, and brand elements.

```typescript
colors.primary[50]           // bg-indigo-50 (lightest)
colors.primary[600]          // bg-indigo-600 (main)
colors.primary[700]          // bg-indigo-700 (darker)
colors.primary.text[600]     // text-indigo-600
colors.primary.text[700]     // text-indigo-700
colors.primary.border[300]   // border-indigo-300
colors.primary.hover.bg      // hover:bg-indigo-700
colors.primary.hover.text    // hover:text-indigo-600
```

### Neutral Colors (Slate)

Used for text, borders, and backgrounds.

```typescript
colors.neutral[50]              // bg-slate-50 (lightest background)
colors.neutral[200]             // bg-slate-200 (borders)
colors.neutral[700]             // bg-slate-700 (dark text)
colors.neutral.text[500]        // text-slate-500
colors.neutral.text[700]        // text-slate-700
colors.neutral.border[200]      // border-slate-200
colors.neutral.hover.bg[50]     // hover:bg-slate-50
```

### Entity Type Colors

Used for knowledge graph nodes and entity-specific styling.

```typescript
concept  // emerald; canonical technical objects and concept cards
claim    // violet; theorems, propositions, and central results
method   // indigo; algorithms, procedures, and architectures
formula  // amber; significant equations and objectives
symbol   // blue; only promoted paper-level notation
```

`GraphNode.tsx` and `NodeInfoPanel.tsx` map canonical types onto the existing entity tokens while dedicated canonical tokens are pending. Formula-local symbols use collapsed facet styling and are not peer graph nodes.

### Relationship Colors

Used for edge colors in knowledge graphs.

```typescript
colors.relationship.uses.hex          // '#6366f1' (indigo)
colors.relationship.depends_on.hex    // '#f59e0b' (amber)
colors.relationship.defines.hex       // '#10b981' (emerald)
supports                              // violet
derives_from                          // sky
evaluated_by                          // pink
has_formula                           // teal
```

### Destructive/Error Colors (Red)

```typescript
colors.destructive.hover.text     // hover:text-red-600
colors.destructive.hover.bg       // hover:bg-red-50
```

---

## 2. Typography

```typescript
textStyles.h1              // text-xl font-bold text-slate-900
textStyles.h2              // text-lg font-semibold text-slate-900
textStyles.body            // text-sm text-slate-700
textStyles.label           // text-xs font-medium text-slate-600
textStyles.sectionHeader   // text-xs font-semibold text-slate-500 uppercase tracking-wider
```

---

## 3. Component Styles

### Buttons

```typescript
componentStyles.button.primary      // indigo bg, white text
componentStyles.button.secondary    // white bg, border, slate text
componentStyles.button.icon         // icon-only
```

### Cards

```typescript
componentStyles.card.default        // standard card
componentStyles.card.selected       // highlighted/selected card
```

### Input Fields

```typescript
componentStyles.input.default       // text input
componentStyles.input.textarea      // textarea
```

### Dialogs/Modals

```typescript
componentStyles.dialog.overlay      // backdrop
componentStyles.dialog.container    // modal container
componentStyles.dialog.header       // header section
componentStyles.dialog.body         // body content
componentStyles.dialog.footer       // footer actions
```

---

## 4. Reusable Components

Import from `@/components/ui`:

```typescript
import { Button, IconButton, Card, CardHeader, CardContent, CardActions, EmptyState, CollapsibleSection, TreeView } from '@/components/ui';
```

### Button

```typescript
<Button variant="primary" onClick={handleSave}>Save Changes</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="primary" size="sm" icon={Save}>Save</Button>
<Button variant="primary" loading={isSaving}>Saving...</Button>
<IconButton icon={Edit2} label="Edit" />
<IconButton icon={Trash2} label="Delete" variant="destructive" />
```

**Props:** `variant` (`'primary' | 'secondary' | 'ghost' | 'icon'`), `size` (`'sm' | 'md'`), `icon` (Lucide component), `loading`, `disabled`

### Card

```typescript
<Card selected={isSelected}>
  <CardHeader actions={<><IconButton icon={Edit2} label="Edit" /><IconButton icon={Trash2} label="Delete" variant="destructive" /></>}>
    <h3 className="font-medium">Card Title</h3>
  </CardHeader>
  <CardContent expanded={isExpanded}>
    <p>Detailed content...</p>
  </CardContent>
  <CardActions><Button size="sm">Action</Button></CardActions>
</Card>
```

### EmptyState

```typescript
<EmptyState icon={FileText} title="No items found" description="Try adding some items" variant="sidebar" />
<EmptyState icon={FileText} title="No comments yet" variant="card" action={<Button size="sm">Add Comment</Button>} />
```

**Props:** `icon` (required), `title` (required), `description`, `variant` (`'sidebar' | 'card'`), `action`

### CollapsibleSection

```typescript
<CollapsibleSection title="AI Suggestions" defaultExpanded={true} badge={15} icon={Sparkles}>
  <div className="space-y-2">{suggestions.map(s => <div key={s.id}>{s.content}</div>)}</div>
</CollapsibleSection>
```

**Props:** `title`, `children`, `defaultExpanded`, `badge`, `icon`, `indentLevel`

### TreeView

```typescript
<TreeView
  nodes={tocNodes}
  renderNode={(node, { isExpanded, depth, isActive, toggle }) => (
    <button onClick={() => onNavigate(node.id)} className={isActive ? 'text-indigo-700 font-medium' : 'text-slate-700'}>
      <span dangerouslySetInnerHTML={{ __html: node.title }} />
    </button>
  )}
  getNodeId={(node) => node.id}
  getNodeChildren={(node) => node.children}
  activeNodeId={currentSectionId}
  defaultExpanded={true}
/>
```

**Props:** `nodes`, `renderNode`, `getNodeId`, `getNodeChildren`, `activeNodeId`, `defaultExpanded`, `indentSize` (default 12), `baseIndent` (default 8)

**Render props:** `isExpanded`, `isActive`, `depth`, `hasChildren`, `toggle`

---

## 5. Legacy Color Constants (`colors.ts`)

For components still using the older system. Import from `@/lib/colors`:

```typescript
import { TEXT, BG, BORDER, INPUT, BUTTON } from '@/lib/colors';

<input className={INPUT.base} placeholder="Type here..." />
<button className={BUTTON.primary}>Save</button>
<button className={BUTTON.secondary}>Cancel</button>
```

### Text Colors

| Use Case | Class |
|----------|-------|
| Main content | `text-slate-900` |
| Secondary content | `text-slate-600` |
| Tertiary/helper | `text-slate-500` |
| Muted/disabled | `text-slate-400` |
| Placeholders | `placeholder:text-slate-400` |
| Accent/brand | `text-indigo-600` |

### Background Colors

| Use Case | Class |
|----------|-------|
| Primary | `bg-white` |
| Secondary | `bg-slate-50` |
| Accent | `bg-indigo-600` |
| Accent light | `bg-indigo-50` |

### Key Principles

1. **Always use `text-slate-900` for user input** — never light gray
2. **Use `bg-white` for form elements** — don't use gray backgrounds for inputs/selects
3. **Placeholders are `text-slate-400`** — lighter than input text but visible
4. **Dropdown options are `text-slate-900`** — dark text on white/light backgrounds
5. **Icons inherit text color** — add `className="text-slate-400"` to make them visible

---

## 6. Entity Styling in CSS

### In-Paper Entity Spans

```css
/* From globals.css */
.kg-entity {
  border-bottom: 1px dotted;
  cursor: help;
}
.kg-entity[data-entity-type="symbol"]     { border-color: rgb(59, 130, 246); }
.kg-entity[data-entity-type="definition"] { border-color: rgb(16, 185, 129); }
.kg-entity[data-entity-type="theorem"]    { border-color: rgb(139, 92, 246); }
```

### The Semantic Lens shell

Everything the lens renders — a term, an equation, a relation, a quote — is
dressed by one set of classes in `styles/reader-interactions.css`:
`.semantic-lens-panel` for the scroll container, `.semantic-lens` for the stack,
`.semantic-lens-header` / `.semantic-lens-title` for the heading,
`.semantic-lens-text` for a body paragraph or a notation meaning,
`.semantic-lens-section-title` for a section heading, `.semantic-chip` for a tag.

Do not restyle a branch with Tailwind utilities. Two reasons, both observed:
a utility-dressed branch drifts away from its neighbour in heading size,
spacing, and colour, which a reader sees the moment they open a term after an
equation; and the Theia bundle imports Tailwind's theme and utilities without
its preflight, so a `h3`, `p`, or `dd` that does not set its own margin keeps
the browser default there while looking fine in the Next.js reader. Every rule
in the shared file therefore states its own margin and takes colour from a
`--theia-*` token with a light-theme fallback.

Role tags, notation units, and constraints use `.semantic-chip` and its siblings
in the same file: a transparent background with a `--theia-widget-border`
outline, never a tinted fill.

The outline is not decoration. A pale fill such as `bg-slate-100` (`#f1f5f9`) sits within a couple
of percent of the panel surface in both the light Theia theme and the web
reader, so the chip reads as loose text and it is impossible to tell whether
there is a chip at all. And a fill that is visible only by hue excludes readers
with colour vision deficiency; an outline states the boundary through shape.

The same file is imported by `app/globals.css` and by the Theia extension's
`scholar.css`, so both clients inherit any change made there. Inside the lens,
prefer these classes over Tailwind colour utilities: only the shared file can
resolve Theia theme tokens and follow a dark theme.

Notation symbols keep horizontal overflow for genuinely long LaTeX but hide
vertical overflow explicitly. Setting only `overflow-x: auto` makes CSS compute
the other axis as scrollable too, which exposed a one-pixel MathJax height
mismatch as a useless vertical scrollbar. A lone hidden `Edit`/`Add` action is
positioned out of flow, so it appears on hover/focus without leaving an empty
bordered slot beside every formula or notation meaning; edited-state controls
remain in flow because their badge and restore actions carry persistent state.
Formula-title badge styling explicitly excludes `.semantic-editable-actions`:
the transparent button's parent must not retain an opaque badge background that
covers the title while the action itself is hidden.

---

## 7. Quick Reference

```typescript
// Most common patterns
<Button variant="primary">Action</Button>
<IconButton icon={Edit2} label="Edit" />
<IconButton icon={Trash2} label="Delete" variant="destructive" />
<EmptyState icon={FileText} title="No items" variant="sidebar" />
<Card selected={selected}><CardHeader>Title</CardHeader><CardContent>Content</CardContent></Card>
<input className={componentStyles.input.default} />
<h3 className={textStyles.sectionHeader}>Section Title</h3>
```

### Color Reference Chart

| Usage | Token | Class | Hex |
|-------|-------|-------|-----|
| Primary action | `colors.primary[600]` | `bg-indigo-600` | `#4f46e5` |
| Primary hover | `colors.primary[700]` | `bg-indigo-700` | `#4338ca` |
| Symbol entity | `colors.entity.symbol.hex` | — | `#3b82f6` |
| Definition entity | `colors.entity.definition.hex` | — | `#10b981` |
| Theorem entity | `colors.entity.theorem.hex` | — | `#8b5cf6` |
| Neutral text | `colors.neutral.text[700]` | `text-slate-700` | `#334155` |
| Border | `colors.neutral.border[200]` | `border-slate-200` | `#e2e8f0` |
| Destructive | `colors.destructive.text[600]` | `text-red-600` | `#dc2626` |

---

## 8. Migration Guide

When refactoring existing components:

1. **Replace inline color classes with design tokens:**
   ```typescript
   // Before
   className="bg-indigo-600 text-white hover:bg-indigo-700"
   // After
   className={componentStyles.button.primary}
   ```

2. **Replace buttons with Button component:**
   ```typescript
   // Before
   <button className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg">Save</button>
   // After
   <Button variant="primary">Save</Button>
   ```

3. **Replace empty states with EmptyState:**
   ```typescript
   // Before
   if (items.length === 0) { return <div className="flex flex-col...">No items</div>; }
   // After
   if (items.length === 0) { return <EmptyState icon={FileText} title="No items" variant="sidebar" />; }
   ```

## 9. Extending the Design System

**New tokens:** Edit `lib/design-system.ts`, follow existing naming conventions, update this doc.

**New components:** Create in `components/ui/`, export from `components/ui/index.ts`, use design tokens, document here.