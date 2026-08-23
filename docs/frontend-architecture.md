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
  is_user_override?: boolean;   // Only reader wording replaces graph text
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
│   │   ├── KnowledgeGraphView.tsx  # Stable wrapper and public selection contracts
│   │   ├── ProgressiveKnowledgeGraphView.tsx # Bounded overview, expansion, search, evidence
│   │   ├── knowledge-graph-controller.ts # Framework-neutral bounded graph control bridge
│   │   ├── paper-search-controller.ts # Scoped DOM find engine and controller
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
        ├── scholar-paper-find-toolbar.tsx # Native expandable find action
        ├── scholar-paper-graph-widget.tsx # Dynamic central knowledge-graph tab per paper
        ├── scholar-graph-selection.ts  # Source-aware Theia graph selection
        ├── scholar-graph-property-view.tsx # Native Property View provider (fallback)
        ├── scholar-semantic-lens-widget.tsx # Right-sidebar Semantic/Equation Lens
        ├── scholar-side-widgets.tsx    # Papers library
        ├── scholar-native-widgets.tsx  # Native trees, annotation detail/editor
        ├── scholar-annotation-preview.tsx # LaTeX-aware comment tree rows
        ├── scholar-annotation-service.ts # Shared annotation selection and draft state
        ├── scholar-suggestion-service.ts # Per-paper suggestion state and API workflows
        ├── scholar-suggestion-widgets.tsx # Native grouped tree and details/editor
        ├── scholar-llm-settings-service.ts # Evented LLM baseline/draft and Saveable state
        ├── scholar-llm-settings-widget.tsx # Restorable central LLM Settings tab
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

The paper widget no longer renders an embedded React find strip. Each
`ScholarPaperWidget` owns one stable `PaperSearchController`, scoped to the
`.html-renderer` below that widget's own DOM node. The shared DOM engine performs
case-insensitive literal matching, creates and removes `mark` highlights,
cycles through matches, and publishes immutable query/count/focus snapshots.
It clears pending work and highlights on close or disposal and refreshes an
open query when React replaces the paper content. This keeps restored and split
paper tabs independent and makes loading or temporarily missing content safe.

`ScholarContribution` exposes Find through the Edit menu, Command Palette,
`Ctrl/Cmd+F`, and a search icon in the tab toolbar. Opening it replaces the icon
with `ScholarPaperFindToolbar`, a custom React tab-toolbar action containing the
input, match count, previous/next, and close controls. Repeating the command
focuses and selects the current query; `Enter`, `Shift+Enter`, and `Escape`
navigate or close without delegating to browser find. Closing resets the query
and returns focus to the paper. The contribution subscribes only to the active
paper widget for outer toolbar visibility and drops that subscription when the
active or restored tab changes. The standalone Next.js `SearchBar` uses the
same controller engine but preserves its existing embedded appearance and API.

The `Navigate` `ViewContainer` holds `Sections`, built on Theia's `TreeWidget`,
including keyboard navigation, selection, incremental search, and theme
tokens. The knowledge graph is not part of this side container: `Open
Knowledge Graph` opens a dedicated central tab per paper (one
`ScholarPaperGraphWidget` per `paperId`, reused on repeat opens), split to the
right of the paper it belongs to. Selecting a graph node or edge publishes a
source-aware value through Theia's `SelectionService`. The paper widget uses the
same selection channel for focusable inline semantic anchors and equations.
Explicit click, `Enter`, or `Space` loads the shared semantic details or
Equation Lens; hover still does nothing.

`ScholarSemanticLensWidget` is the primary surface for those details. It is a
standalone right-sidebar view (`Semantic Lens`, rank 90, ahead of `Annotations`
and `Term Highlights`) that renders the same `SemanticDetails`/`EquationLens`
components as the web reader. A reading pane must not compete with the article
for vertical space, so the lens deliberately lives beside the text instead of
below it: the bottom `Property View` grows over the centre of the screen, which
is exactly where the paper is read.

The widget subscribes to `SelectionService` itself, so it shows the current
subject even when it is created late. A semantic selection is revealed through
`ApplicationShell.revealWidget`, never `activateWidget`: the tab becomes visible
while focus and keyboard navigation stay in the paper. The reveal calls are
serialised so repeated selections cannot dock the view twice. Only an explicit
empty selection clears the lens; selecting a library or outline row leaves the
last reading context on screen. Stale responses are dropped by an update
counter, and a failed lookup renders the error instead of an endless spinner.
The widget is bound transiently, because closing the tab disposes it and a
singleton binding would return a disposed instance to the widget factory.

Definitions and their strict mathematical representation form one card. When
an object has a `defining_equation`, selecting either the highlighted term or
the displayed equation renders the same order: `SemanticSubjectSummary` with
the term and explanation, the editable equation name and formula, all notation
rows expanded, the term's evidence locations, and the equation location. The
defined object is excluded from the ordinary `Related` list because repeating
it there would weaken an identity link into a generic association. Objects may
have no defining equation and never receive more than one; the client does not
infer this relation from labels.

The lens is also where the reader corrects the agent. Every text it shows is
rendered through `EditableSemanticText`: the description of a term, the name of
an equation, and the meaning of each notation row. Editing happens inline —
pencil turns the text into a textarea with `Save`/`Cancel`, `Escape` cancels and
`Ctrl`/`Cmd+Enter` saves — so a correction never moves the reader out of the
panel where the text is read.

The edit controls stay out of the way until they are wanted: they are
transparent until the pointer enters the text they belong to, and become visible
again on keyboard focus, on a pointer-less device, and whenever the subject has
no text at all (otherwise `Add` would be undiscoverable). A notation table has
one row per symbol, so always-visible buttons produced a ragged column of `Edit`
labels next to the meanings they were supposed to serve. They are hidden with
`opacity`, not `display`, so they keep their place in the tab order and the row
never reflows; a busy button is dimmed by colour for the same reason.

There is exactly one text per subject, not an agent card plus a reader card: two
competing explanations of the same symbol only force the reader to decide which
one to trust. A reader edit is stored as a `Tooltip` keyed by the subject stable
id (`entity:…`, `notation:…`, `equation:…`), which means an applied term highlight
and a hand-typed correction are the same record. The lens shows the reader's
wording when it differs from the agent's, marks it `edited`, and offers
`Show original` and `Restore`. Restore deletes only the note; the injected
anchors stay, so the term remains clickable in the paper. Paragraph comments
(`dom_node_id` without `entity_id`) are not treated as subject wording — they
belong to the block they annotate and stay in `Annotations`.

`View → Semantic Lens` and `Alt+Shift+L` reopen the view. The native bottom
`Property View` provider stays registered as a secondary, flat-table channel for
the same selections. This makes the Theia Desktop reader the primary
semantic-reading surface while retaining the Next.js reader as a compatible
reference client.

Everything the lens shows goes through MathJax: notation meanings, units,
constraints, related labels, explanations, and note content. Because extracted
meanings historically stored bare fragments such as `y_l`, `lib/inline-math.ts`
wraps those tokens in `$...$` before rendering. The heuristic is narrow on
purpose — a token is wrapped only when the whole token is a symbol with a
sub/superscript or a LaTeX command, so prose, `snake_case` identifiers, and
already-delimited math are untouched. `toMathSource` normalizes standalone
expressions so stored `$x$` and `x` render identically.

A term and an equation are dressed by one shell. Both branches of
`SemanticDetails` render `.semantic-lens` with a `.semantic-lens-header`, a
`.semantic-lens-title`, `.semantic-lens-text` bodies, shared section headings,
and `.semantic-chip` tags, all defined once in `styles/reader-interactions.css`
and coloured from Theia theme tokens. The term branch used to be written in
Tailwind utilities instead, which produced exactly what a reader notices when
the two halves are compared: a larger heading, wider spacing, and slate text
that ignores the active theme. In Theia it went further — the extension bundle
imports `tailwindcss/theme.css` and `tailwindcss/utilities.css` but not
preflight, so an unreset `h3` kept the browser's own `1em` margin and showed up
as an unexplained gap above the term name. Every element of the lens therefore
states its own margin, and no Tailwind colour or spacing utility is used inside
the panel.

An unlinked equation card opens with its name and nothing above it. The header used to
carry the extracted `paper_role` in small caps, but nothing constrained that
field, so it usually repeated the summary as a full sentence; the field is gone
from the schema rather than narrowed to a vocabulary that no field of study
shares.

Evidence is presented as places, not quotes. `EvidenceLocations` names the
section (or the displayed equation when no section is known) and shows the
supporting quote only when it adds something. Semantic API evidence arrives in
paper order (section, DOM node, then character offset), rather than the
parallel-extraction order stored in `evidence_ids`, so `Appears in` follows the
reader from Abstract through the body and conclusion. Equation observations are anchored
with the equation LaTeX as their quote, so repeating it under the rendered
formula would be pure duplication; that self-quote is dropped and only the
location remains clickable.

Neither the locations nor the header carry a subject kind. An observation always
reports the kind of the subject it grounds, so the line printed the same word
once per location, and the header printed it again above the title. The word
itself is our taxonomy (`topic`, `claim`, `procedure`, `artifact`, `quantity`),
and about two thirds of the anchored terms in a paper fall into `artifact`, so it
distinguished almost nothing. The kind stays in the graph for ranking and
filtering; the roles below the title carry what a reader can act on.

`KnowledgeGraphView` remains the sole owner of graph loading, React Flow nodes
and edges, filters, selection, focus, and dagre layout. A stable
`KnowledgeGraphController` exposes only a framework-neutral snapshot and graph
actions. Each `ScholarPaperGraphWidget` owns one controller subscription and
clears it on React unmount, controller replacement, or widget disposal, so
restored and split graph tabs cannot mutate one another.

The Theia graph tab sets `showEmbeddedControls={false}`: its React search/filter
strip and focus chip are replaced by native tab-toolbar and command-palette
commands, while the React Flow minimap and pan/zoom controls remain part of the
canvas. Node search uses Theia's fuzzy single-select picker over labels, types,
and details. Node and relationship filters use a grouped, preselected
multi-select picker and commit atomically only on Accept; cancellation preserves
the current filters, including when every type is hidden. Focus is a toggled
command, reset reruns the current dagre layout and fits the viewport, and Reveal
in Paper is enabled only for a selected node with a source DOM ID.

The active graph publishes visible/total node and relationship counts, selected
filter labels, and focus state through a dedicated status-bar element. The
contribution subscribes only to the current graph widget and rechecks controller
identity after asynchronous pickers, preventing a closed or replaced tab from
receiving late results. The standalone Next.js reader keeps embedded controls
and selection overlays by default.

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

The separate right-sidebar `Term Highlights` `ViewContainer` holds `Highlights`
and `Highlight Details`, making pending manual and AI content directly
discoverable without the `Annotations` overflow menu. Its tree is expanded on
first open, details are revealed when a draft is focused or created, and the
container can be reopened through `View → Views`. After Theia restores a legacy
layout, `ScholarContribution.onDidInitializeLayout` moves any saved suggestion
parts out of `Annotations` and adds this container beside it without resetting
unrelated tabs, panel sizes, or placements. `Highlights` is a searchable native
`TreeWidget` grouped as
`Manual / AI → entity type → highlight`. Its leaf and group checkboxes derive
tri-state selection from `ScholarSuggestionService`, while row focus reveals
the separate `Highlight Details` `ReactWidget`. The service keeps checked IDs,
focus, transient edits, create drafts, loading, and mutation state isolated by
paper ID and rejects stale list responses. `Generate AI Term Highlights`,
`Apply Selected Term Highlights`, `Create Manual Term Highlight`, and
`Delete Term Highlight` are Theia commands exposed through the tree toolbar,
context menu, or details widget. Apply refreshes the shared paper and
tooltip caches so the reader and comments update immediately.

`Re-anchor Terms in Paper` sits in the library context menu next to the graph
commands. It recomputes where the graph's subjects occur in the paper and then
reloads the paper, so an improved anchoring rule reaches an existing paper
without a paid rebuild. It opens no confirmation dialog, because unlike
`Build Knowledge Graph` it calls no model; term highlights still have to be
applied afterwards for the new anchors to become visible highlights.

Generate and Apply publish per-paper `Generating term highlights…` and
`Applying term highlights…` phases through the shared workspace status, so the
native bottom status bar stays visible for the entire request and subsequent
reload. The finish callback is ownership-guarded: a late completion cannot
clear a newer operation or another paper's status. The current suggestion
endpoints do not stream percentage progress, so these phases intentionally use
an indeterminate spinner rather than a fabricated percentage.

The Next.js `TooltipSuggestionsDialog.tsx` remains the reference-client
consumer of the tooltip contracts. Generate shares the existing
`scholar-agent-expertise` storage key and default text with that client.

LLM provider and workflow settings are available in a separate central `LLM
Settings` tab. `ScholarLlmSettingsService` owns an immutable server baseline,
an in-memory draft, explicit keep/replace/clear credential intent, discovery
metadata, and one test outcome per workflow. Its generation and fingerprint
guards reject late model-list or test responses after the relevant draft has
changed. It implements Theia `Saveable`, while `ScholarLlmSettingsWidget`
exposes it as a `SaveableSource`; native close therefore provides Save, Don't
Save, and Cancel, and failed saves leave the tab dirty. The widget intentionally
does not implement `storeState` or `restoreState`, so layout persistence stores
only its stable factory identity and never the form draft or plaintext key.

`Open LLM Settings` reuses one widget and is available from the command palette,
`File → Settings`, and the Manage settings menu. The tab toolbar exposes Revert,
Refresh Models, and one targeted Test action per workflow. Native `File → Save`
and `Ctrl/Cmd+S` work through `Saveable`, avoiding a duplicate settings-specific
File menu entry. The Next.js `SettingsDialog.tsx` and the Theia service both use
`lib/llm-settings-api.ts`, which strictly maps camelCase UI objects to snake_case
wire JSON. Discovery and tests use the exact unsaved connection draft; API keys
are sent only in request bodies and never in URLs, command arguments, layout
state, notifications, or response snapshots.

```bash
cd frontend
npm run dev:theia             # browser + backend
npm run dev:theia:desktop     # Electron + backend
```

## Entity Styling

### Knowledge Graph Node Types

The graph presents `topic`, `claim`, `procedure`, `artifact`, and `quantity` objects. Equations and scoped notation are separate reader records shown through Equation Lens and glossary lookup rather than peer graph nodes. Cards include aliases, roles/facets, decomposed signals, evidence, and omitted-link counts.

The initial request is a 20-node sparse overview and the server hard cap is 30. One-hop/source-focused responses merge by stable ID up to a client-visible cap of 50. Search results remain outside React Flow until explicitly revealed; Dagre runs only when topology changes, and omitted relations are loaded only through explicit expansion.

### In-Paper Entity Spans

Injected `.kg-entity` spans carry `data-occurrence-id` and `data-subject-id`, are keyboard-focusable, and activate only on click, Enter, or Space. There are no hover cards or hover-triggered details. Explicit term or equation selection opens the existing navigation sidebar; split-layout integrations retain selection without auto-opening a panel.

`SemanticDetails` and `EquationLens` share one framework-neutral `SemanticSelection` union across Next.js and Theia. `reader-workspace-store.ts` caches bounded section annotations, subject details, and equation details per paper. Glossary search never inserts results into React Flow.

`ScholarSemanticLensWidget` builds its replacement-text map only from entity
tooltips carrying `is_user_override=true`. Applied AI drafts remain annotations
and anchors but do not shadow a newly rebuilt graph explanation merely because
their stored text came from an older build.

## API Integration

### Knowledge Graph Endpoints

`lib/knowledge-graph-api.ts` validates the wire contract before graph state is updated. Both the Next.js reader and Theia widget use the same controller and bounded data:

```text
GET /api/papers/{paperId}/knowledge-graph/overview
GET /api/papers/{paperId}/knowledge-graph/subgraph
GET /api/papers/{paperId}/knowledge-graph/search
GET /api/papers/{paperId}/knowledge-graph            # export/debug only
```

The controller exposes server search, one-hop expansion, source focus, dynamic filters, selection evidence, and bounded snapshots. `NavigationPanel` passes the current section as a source focus. Legacy unversioned graphs render a rebuild-required state.

### Semantic Endpoints

```text
GET /api/papers/{paperId}/semantic/sections/{sectionId}/annotations
GET /api/papers/{paperId}/semantic/subjects/{subjectId}
GET /api/papers/{paperId}/semantic/equations/{equationId}
GET /api/papers/{paperId}/semantic/glossary
```

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

// Replace or restore the agent's wording for one subject
PUT    /api/papers/{paperId}/semantic-notes/{subjectId}
DELETE /api/papers/{paperId}/semantic-notes/{subjectId}
```

Suggestion payloads are validated at the client boundary, and that validator is
part of the contract: it checked the pre-rework occurrence shape
(`section_id`, `char_offset`, `snippet`) long after the backend moved to
schema-v3 anchors, so every generated suggestion was rejected as
`Malformed response from server`. `ReaderWorkspaceSuggestionApi.test.ts` now
pins both directions — the new shape parses, the old one is rejected.

Apply sends drafts without occurrences (`AppliedTooltipSuggestion`). The
`Term Highlights` panel lists stored suggestions, which keep only label, type
and text, so sending `occurrences: []` claimed the term occurs nowhere and
produced `Applied N term highlights but highlighted no occurrences`: notes
existed but nothing was highlighted. The backend resolves anchors from the
paper's semantic document instead. Because a
note without highlights is invisible, `spans_injected === 0` is reported as a
warning rather than success, and backend skip reasons are surfaced as warnings.
One term may arrive as several adjacent `.kg-entity` spans when inline markup
splits it; `data-occurrence-part` keeps such a word visually whole.

### LLM Settings Endpoints

Both the Next.js reference modal and the native Theia tab use the same typed
adapter for these contracts:

```text
GET  /api/settings/llm         load normalized baseline and credential metadata
PUT  /api/settings/llm         save all three workflow models and key intent
POST /api/settings/llm/models  discover models using the unsaved connection body
POST /api/settings/llm/test    invoke one selected unsaved workflow/model
```

Responses expose only a mask and `database` / `environment` / `none` source.
The three independent model keys are `kg_extraction`, `html_injection`, and
`tooltip_suggestion`; there is no shared user-facing default model.

### SSE Streaming

Knowledge graph build uses Server-Sent Events:
```typescript
// Connect to progress stream
const eventSource = new EventSource(`/api/papers/${paperId}/knowledge-graph/build/progress`);
eventSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  // progress: { stage, label, current, total }
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
