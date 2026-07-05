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
const eventSource = new EventSource(`/api/papers/${paperId}/build-knowledge-graph/progress`);
eventSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  // data: { stage, message, progress? }
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
