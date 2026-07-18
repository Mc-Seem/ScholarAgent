# Frontend Architecture

## Terminology

### Tooltips: Two Types

The app uses "tooltips" as an umbrella term for annotations, but they come in **two distinct types**:

| Type | DB Field | UI Name | Description |
|------|----------|---------|-------------|
| **Comment** | `dom_node_id` set, `entity_id` null | "Comments" tab | Paragraph-level annotation, appears on ONE block |
| **Glossary Entry** | `entity_id` set | "Glossary" tab | Semantic annotation, appears on ALL occurrences of a term |

### Component Mapping

```
TooltipPanel.tsx (right sidebar)
├── mode: 'comments' → TooltipList.tsx    (paragraph comments)
└── mode: 'glossary' → GlossaryList.tsx   (semantic/entity tooltips)
```

### Key Interfaces

```typescript
// From hooks/useTooltips.ts
interface Tooltip {
  id: string;
  paper_id: string;
  dom_node_id: string | null;   // Set for comments
  entity_id?: string | null;    // Set for glossary entries
  content: string;
  target_text?: string | null;  // The term being defined
  // ...
}

// Filtering logic
const commentTooltips = tooltips.filter(t => t.dom_node_id && !t.entity_id);
const glossaryTooltips = tooltips.filter(t => t.entity_id);
```

## Component Structure

```
frontend/
├── app/                        # Next.js pages
│   ├── page.tsx                # Main app (PaperLoader)
│   └── globals.css             # Global styles + .kg-entity
├── components/
│   ├── reader/                 # Paper viewer components
│   │   ├── PaperLoader.tsx     # Main orchestrator
│   │   ├── HTMLRenderer.tsx    # Renders paper HTML
│   │   ├── NavigationPanel.tsx # Left sidebar (TOC + KG)
│   │   ├── TooltipPanel.tsx    # Right sidebar (Comments/Glossary)
│   │   ├── TooltipList.tsx     # Paragraph comments list
│   │   ├── GlossaryList.tsx    # Entity glossary list
│   │   ├── KnowledgeGraphView.tsx  # React Flow graph
│   │   ├── GraphNode.tsx       # KG node component
│   │   └── ...
│   └── ui/                     # Reusable design system components
│       ├── Button.tsx
│       ├── Card.tsx
│       ├── EmptyState.tsx
│       └── ...
├── hooks/
│   ├── useTooltips.ts          # Tooltip CRUD + maps
│   ├── useApi.ts               # API fetch utilities
│   └── ...
├── lib/
│   ├── colors.ts               # Color constants (legacy)
│   └── design-system.ts        # Full design system tokens
└── utils/
    └── parseTOC.ts             # Table of contents parser
```

## Data Flow

```
PaperLoader.tsx
├── State: paper, tooltips, sections, etc.
├── useTooltips(paperId) → {tooltips, tooltipMap, entityTooltipMap, ...}
│
├── Left Panel: NavigationPanel
│   ├── Tab: TOC → TableOfContents
│   └── Tab: Graph → KnowledgeGraphView
│
├── Center: HTMLRenderer
│   ├── Renders paper.html_content
│   ├── InteractiveNode wraps blocks with data-id
│   └── .kg-entity spans trigger hover/click events
│
└── Right Panel: TooltipPanel
    ├── Tab: Comments → TooltipList (dom_node_id tooltips)
    └── Tab: Glossary → GlossaryList (entity_id tooltips)
```

## Theia Platform Pilot

The pilot lives beside the Next.js reference client and reuses its reader
components. It does not change backend endpoints or database models.

```
frontend/theia/
├── browser-app/                 # Theia browser product
├── electron-app/                # Theia Electron product
└── scholar-extension/
    └── src/browser/
        ├── scholar-paper-widget.tsx    # Dynamic central tab per paper
        ├── scholar-paper-graph-widget.tsx # Dynamic central knowledge-graph tab per paper
        ├── scholar-graph-selection.ts  # Source-aware Theia graph selection
        ├── scholar-graph-property-view.tsx # Native Property View provider
        ├── scholar-side-widgets.tsx    # Papers library
        ├── scholar-native-widgets.tsx  # Native trees, annotation detail/editor
        ├── scholar-annotation-preview.tsx # LaTeX-aware comment tree rows
        ├── scholar-annotation-service.ts # Shared annotation selection and draft state
        ├── scholar-suggestion-service.ts # Per-paper suggestion state and API workflows
        ├── scholar-suggestion-widgets.tsx # Native grouped tree and details/editor
        ├── scholar-commands.ts         # Shared Theia command definitions
        ├── scholar-contribution.ts     # Layout, commands, keybindings, status
        └── scholar-frontend-module.ts  # Dependency injection and factories
```

`ReaderWorkspaceStore` is framework-independent and shared by every widget.
It caches paper details and tooltips by paper ID, deduplicates concurrent loads,
and keeps active-entity state isolated per tab. Activating an already loaded
tab therefore does not refetch it. A singleton `HttpReaderWorkspaceApi` supplies
the common FastAPI client, typed tooltip-suggestion operations, and compilation
and knowledge-graph SSE subscriptions.

Theia persists widget factory options (`paperId` and label), so paper tabs,
split groups, and side-view layout restore across restarts. The Next.js
`PaperLoader` remains available as the comparison baseline and fallback.

The paper widget exposes scoped find through its toolbar, the Edit menu, and
`Ctrl/Cmd+F`; matches are limited to the active paper even in split layouts.
The `Navigate` `ViewContainer` holds `Sections`, built on Theia's `TreeWidget`,
including keyboard navigation, selection, incremental search, and theme
tokens. The knowledge graph is not part of this side container: `Open
Knowledge Graph` opens a dedicated central tab per paper (one
`ScholarPaperGraphWidget` per `paperId`, reused on repeat opens), split to the
right of the paper it belongs to. Selecting a graph node or edge publishes a
source-aware value through Theia's `SelectionService`; the standard bottom
`Property View` displays its paper, entity or relation details and connections.

The `Annotations` `ViewContainer` contains `Comments`, `Glossary`, and
`Annotation` for content already attached to the paper. Comments and glossary
entries are compact `TreeWidget` rows grouped by section or entity type. A
comment row previews the attached passage, followed by the annotation in the
theme's muted text color. LaTeX in both parts is rendered with MathJax while the
row remains compact. Selecting it reveals the full annotation and attached
passage, also with LaTeX rendering, in the `Annotation` part; double-clicking or
`Reveal in Paper` navigates to the source block. The same part switches in place
to edit mode and returns to the detail view after save or cancel. Right-click
and detail actions share Theia commands, while creation also uses the embedded
editor instead of a floating React popover. The tree data transformations live in
`lib/scholar-native-tree.ts` so they remain framework-independent and testable.

The separate right-sidebar `Tooltip Drafts` `ViewContainer` holds `Suggestions`
and `Suggestion Details`, making pending manual and AI content directly
discoverable without the `Annotations` overflow menu. Its tree is expanded on
first open, details are revealed when a draft is focused or created, and the
container can be reopened through `View → Views`. After Theia restores a legacy
layout, `ScholarContribution.onDidInitializeLayout` moves any saved suggestion
parts out of `Annotations` and adds this container beside it without resetting
unrelated tabs, panel sizes, or placements. `Suggestions` is a searchable native
`TreeWidget` grouped as
`Manual / AI → entity type → suggestion`. Its leaf and group checkboxes derive
tri-state selection from `ScholarSuggestionService`, while row focus reveals
the separate `Suggestion Details` `ReactWidget`. The service keeps checked IDs,
focus, transient edits, create drafts, loading, and mutation state isolated by
paper ID and rejects stale list responses. `Generate`, `Apply`, `Create Manual
Suggestion`, and `Delete Suggestion` are Theia commands exposed through the tree
toolbar, context menu, or details widget. Apply refreshes the shared paper and
tooltip caches so the reader and comments update immediately.

Generate and Apply publish per-paper `Generating tooltip drafts…` and
`Applying tooltip drafts…` phases through the shared workspace status, so the
native bottom status bar stays visible for the entire request and subsequent
reload. The finish callback is ownership-guarded: a late completion cannot
clear a newer operation or another paper's status. The current suggestion
endpoints do not stream percentage progress, so these phases intentionally use
an indeterminate spinner rather than a fabricated percentage.

The Next.js `TooltipSuggestionsDialog.tsx` remains the reference-client
consumer of the unchanged backend contracts. The native workflow does not add
LLM API-key or model settings; Generate only shares the existing
`scholar-agent-expertise` storage key and default text with that client.

```bash
cd frontend
npm run dev:theia             # browser + backend
npm run dev:theia:desktop     # Electron + backend
```

## Entity Styling

### Knowledge Graph Node Types

```typescript
// From lib/design-system.ts
colors.entity.symbol.hex      // '#3b82f6' (blue)
colors.entity.definition.hex  // '#10b981' (emerald)
colors.entity.theorem.hex     // '#8b5cf6' (violet)
```

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

## API Integration

### Tooltip Endpoints

```typescript
// Fetch all tooltips for a paper
GET /api/papers/{paperId}/tooltips

// Create a paragraph comment
POST /api/papers/{paperId}/tooltips
{ dom_node_id: "p_123", content: "My note" }

// Suggest semantic tooltips (AI)
POST /api/papers/{paperId}/tooltips/suggest
{ user_expertise: "intermediate" }

// Apply suggestions (injects <span> tags)
POST /api/papers/{paperId}/tooltips/apply
{ suggestions: [...] }
```

### SSE Streaming

Knowledge graph build uses Server-Sent Events:
```typescript
// Connect to progress stream
const eventSource = new EventSource(`/api/papers/${paperId}/knowledge-graph/build/progress`);
eventSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  // data: { stage, progress, node_count?, edge_count?, error? }
};
```

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- TooltipPanel

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Test Files

```
__tests__/
├── components/
│   ├── TooltipPanel.test.tsx
│   ├── GlossaryList.test.tsx
│   └── ...
└── hooks/
    └── useTooltips.test.tsx
```

## Common Patterns

### Adding a New Tooltip Type/Filter

1. Update `useTooltips.ts` to add new filter logic
2. Update `TooltipPanel.tsx` to add new tab/mode
3. Create new list component if needed
4. Update tests

### Styling a New Component

```typescript
// Use design system
import { componentStyles, colors, textStyles } from '@/lib/design-system';

// Buttons
<button className={componentStyles.button.primary}>Save</button>

// Text
<h2 className={textStyles.h2}>Title</h2>

// Entity colors
<div style={{ borderColor: colors.entity.symbol.hex }}>Symbol</div>
```

### Adding Entity Event Handlers

```typescript
// In HTMLRenderer.tsx or InteractiveNode.tsx
const handleEntityClick = (entityId: string) => {
  // Look up tooltip
  const tooltip = entityTooltipMap[entityId];
  // Navigate or show detail
};
```

## See Also

- `DESIGN_SYSTEM.md` - Full component library documentation
- `lib/COLOR_PALETTE.md` - Color reference guide
- `TESTING.md` - Test guidelines
