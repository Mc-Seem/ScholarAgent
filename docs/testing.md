# Testing Guide

Comprehensive testing approach for Scholar Agent — backend (pytest) and frontend (Vitest).

---

## Test Stack

### Backend
- **pytest** with coverage support (`pytest-cov`)
- Test files in `tests/`

### Frontend
- **Vitest** — fast, modern test runner with ESM support
- **React Testing Library** — component testing utilities
- **@testing-library/jest-dom** — custom DOM matchers
- **jsdom** — DOM implementation for Node.js
- Test files in `frontend/__tests__/`

---

## Running Tests

### Backend

```bash
# Run all backend tests
.venv/bin/pytest tests/ -v

# Run specific test file
.venv/bin/pytest tests/test_api.py -v

# Run specific test
.venv/bin/pytest tests/test_api.py::TestRootEndpoint::test_root_returns_welcome_message -v

# With coverage
.venv/bin/pytest --cov=backend --cov-report=html tests/
# Open htmlcov/index.html in browser
```

### Frontend

```bash
cd frontend

# Run all tests once
npm test

# Watch mode (auto-rerun on file changes)
npm run test:watch

# Interactive UI
npm run test:ui

# With coverage report
npm run test:coverage
# Open coverage/index.html in browser

# Run specific test file
npm test -- __tests__/unit/HTMLRenderer.test.tsx

# Run tests matching a pattern
npm test -- --grep "renders"
```

Use `mise exec -- npm ...` when shell activation is unavailable. From the
project root, `mise run verify` runs the frontend tests plus the Next.js and
Theia browser/Electron production builds with Node.js 24.18.0.

### Quick Command (all tests)

```bash
.venv/bin/pytest tests/ -q && cd frontend && npm test -- --run && cd ..
```

---

## Test Directory Structure

```
tests/                           # Backend pytest tests
├── test_compiler.py             # LaTeXML compiler
├── test_models.py               # Database models
├── test_api.py                  # API endpoints
└── integration/                 # Integration tests
    ├── test_pipeline.py         # Full pipeline
    └── test_migrations.py       # Migration idempotency

frontend/__tests__/
├── setup.ts                     # Test environment setup
├── unit/                        # Unit tests
│   ├── HTMLRenderer.test.tsx
│   ├── MathJaxNode.test.tsx
│   ├── LatexText.test.tsx
│   ├── PaperLoader.test.tsx
│   └── useTooltips.test.ts
└── integration/                 # Integration tests (coming soon)
```

---

## Backend Tests

### LaTeXML Compiler (`tests/test_compiler.py`)
- [x] Test archive extraction (.tar.gz, .zip)
- [x] Test main .tex file detection heuristic
- [x] Test LaTeXML command generation
- [x] Test HTML post-processing (data-id injection)
- [x] Test error handling for malformed LaTeX

### Database Models (`tests/test_models.py`)
- [x] Test Paper model CRUD operations
- [x] Test Tooltip model CRUD operations
- [x] Test foreign key relationships
- [x] Test unique constraints and indexes

### API Endpoints (`tests/test_api.py`)
- [x] Test `POST /api/papers/upload` with valid/invalid files
- [x] Test `GET /api/papers` listing
- [x] Test `GET /api/papers/{paper_id}` retrieval
- [x] Test `DELETE /api/papers/{paper_id}` deletion
- [x] Test tooltip CRUD endpoints
- [x] Test CORS headers
- [x] Test error responses (404, 400, 500)

### Integration Tests (`tests/integration/`)
- [ ] Upload arXiv .tar.gz → verify paper created in DB
- [ ] Compile LaTeX → verify HTML has data-ids
- [ ] Fetch compiled HTML → verify MathML present
- [ ] Create tooltip → verify persistence in DB
- [ ] Retrieve tooltips → verify correct mapping
- [ ] Test upgrade from empty DB to latest schema
- [ ] Test downgrade and re-upgrade (idempotency)

---

## Frontend Tests

### HTMLRenderer (`__tests__/unit/HTMLRenderer.test.tsx`) ✅
- [x] html-react-parser basic parsing
- [x] `<math>` tag interception
- [x] `<p>` tag interception with data-id
- [x] Nested element handling
- [x] Malformed HTML handling
- [x] List rendering
- [x] CSS classes

### useTooltips Hook (`__tests__/unit/useTooltips.test.ts`) ✅
- [x] Tooltip fetching from API
- [x] Tooltip creation, update, deletion
- [x] Error handling
- [x] Tooltip map building
- [x] Loading states

### MathJaxNode (`__tests__/unit/MathJaxNode.test.tsx`) ✅
- [x] MathML rendering
- [x] Semantic enrichment (SRE) activation
- [x] Inline vs display math
- [x] MathJax typesetting
- [x] Error handling
- [x] Complex MathML structures

### LatexText (`__tests__/unit/LatexText.test.tsx`) ✅
- [x] Inline math delimiter conversion
- [x] Display math handling
- [x] MathJax integration
- [x] Text-only rendering
- [x] Edge cases (empty strings, special characters)
- [x] Multiple math expressions
- [x] Nested delimiters

### PaperLoader (`__tests__/unit/PaperLoader.test.tsx`) ✅
- [x] Main interface rendering
- [x] Paper fetching on mount
- [x] File upload handling
- [x] arXiv paper fetching
- [x] Loading states
- [x] Error handling
- [x] Cached papers list
- [x] Paper selection
- [x] HTMLRenderer integration
- [x] Compilation prompt
- [x] Recompile action
- [x] Delete action with confirmation

### InteractiveNode (`__tests__/unit/InteractiveNode.test.tsx`)
- [ ] Tooltip display on click
- [ ] Tooltip creation modal
- [ ] Framer Motion animations
- [ ] data-id attribute binding

---

## Writing Frontend Tests

### Component Test Example

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MyComponent } from '@/components/MyComponent'

describe('MyComponent', () => {
  it('renders content correctly', () => {
    render(<MyComponent title="Hello" />)
    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('handles click events', async () => {
    const handleClick = vi.fn()
    render(<MyComponent onClick={handleClick} />)
    await userEvent.click(screen.getByRole('button'))
    expect(handleClick).toHaveBeenCalledOnce()
  })
})
```

### Hook Test Example

```ts
import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMyHook } from '@/hooks/useMyHook'

describe('useMyHook', () => {
  it('fetches data on mount', async () => {
    const { result } = renderHook(() => useMyHook('param'))
    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.data).toBeDefined()
  })
})
```

### Mocking

```ts
// Mock a module
vi.mock('@/components/SomeComponent', () => ({
  SomeComponent: ({ children }: any) => <div>Mocked: {children}</div>
}))

// Mock fetch API
const mockFetch = vi.fn()
global.fetch = mockFetch
mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: 'test' }) })

// Mock Next.js Router
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), pathname: '/' }),
  usePathname: () => '/',
}))
```

---

## Best Practices

1. **Test user behavior, not implementation:**
   ```tsx
   // ❌ Bad
   expect(component.state.isOpen).toBe(true)
   // ✅ Good
   expect(screen.getByRole('dialog')).toBeVisible()
   ```

2. **Use semantic queries:**
   ```tsx
   // Best
   screen.getByRole('button', { name: /submit/i })
   screen.getByLabelText('Email')
   // OK
   screen.getByText('Click me')
   // Avoid
   screen.getByTestId('submit-btn')
   ```

3. **Wait for async updates:**
   ```tsx
   await waitFor(() => {
     expect(screen.getByText('Loaded!')).toBeInTheDocument()
   })
   ```

4. **Organize tests by feature:**
   ```tsx
   describe('HTMLRenderer', () => {
     describe('when rendering math', () => {
       it('intercepts math tags', () => { ... })
       it('renders with MathJax', () => { ... })
     })
     describe('when rendering paragraphs', () => {
       it('makes them interactive', () => { ... })
       it('preserves data-id attributes', () => { ... })
     })
   })
   ```

---

## Coverage Goals

- **Backend**: 80% line coverage minimum
- **Frontend**: 70% line coverage minimum
- **Critical paths**: 100% coverage (LaTeXML compilation, tooltip persistence, HTML rendering)

---

## Manual Testing Checklist

### Core Workflow
- [ ] Upload sample arXiv source (e.g., `2401.12345.tar.gz`)
- [ ] Verify compilation completes without errors
- [ ] Inspect HTML output for data-id attributes
- [ ] Verify all math formulas render correctly
- [ ] Click on formula symbol → verify selection
- [ ] Click on paragraph → create tooltip
- [ ] Refresh page → verify tooltip reappears
- [ ] Delete paper → verify all related data removed

### Edge Cases
- [ ] Upload invalid .tar.gz (should error gracefully)
- [ ] Upload LaTeX with compilation errors (should report errors)
- [ ] Upload very large paper (>100 pages)
- [ ] Create tooltip on math symbol vs text paragraph
- [ ] Multiple tooltips on same paper
- [ ] Delete paper with existing tooltips

### Browser Compatibility
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari (if available)

---

## CI/CD Integration

```yaml
name: Tests
on: [push, pull_request]

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_DB: scholaragent_test
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with: { python-version: '3.12' }
      - run: pip install uv && uv sync
      - run: pytest tests/
        env:
          DATABASE_URL: postgresql://postgres:test@localhost/scholaragent_test

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v4
        with: { node-version: '24.18.0' }
      - run: cd frontend && npm ci
      - run: cd frontend && npm test -- --run
```

---

## Troubleshooting

### "Cannot find module '@/...'" (frontend)
Check `vitest.config.ts` has the alias:
```ts
resolve: { alias: { '@': path.resolve(__dirname, './') } }
```

### "act(...) warnings"
Wrap async assertions in `waitFor()`:
```ts
await waitFor(() => { expect(result.current.data).toBeDefined() })
```

### Tests timeout
Increase timeout in `vitest.config.ts`:
```ts
test: { testTimeout: 10000 }
```

---

## Remaining Test Work

### Current Semantic/KG Verification (2026-08-23)

- `211` backend tests pass, including schema-v3 integrity, strict defining-equation identity, ontology/qualifier separation, scoped notation, deterministic occurrences/injection, sparse projection, corpus metrics, semantic APIs, progress, and retrieval regressions.
- `471` frontend tests pass, including the unified term/formula lens, click/keyboard-only annotations, Equation Lens selection, sidebar/back/split behavior, glossary, schema-v3 graph details, workspace caches, and shared Theia selections.
- `ScholarSemanticLensWidget.test.tsx` and the `Semantic Lens placement` suite in `ScholarContribution.test.ts` cover the side-view lens: right-area docking ahead of the authoring views, reveal without activation, sticky content on unrelated selections, stale-response and error handling, reader wording shown in place of the agent text with `Show original`, an edited symbol meaning saved against its notation subject, restore delegated to the subject-keyed delete, and a paragraph comment that must not become the equation name.
- `TestSemanticNotes` in `tests/test_api.py` pins the note contract: the row is anchored to the subject rather than a DOM node, a second edit replaces the first, blank content is rejected, and restoring keeps `span.kg-entity` anchors in the stored HTML.
- The suggestion contract is pinned from both ends: `test_tooltip_suggestion.py` asserts the endpoint returns schema-v3 occurrence keys and validates `entity_types` against object kinds, and `ReaderWorkspaceSuggestionApi.test.ts` asserts the client parses that shape and rejects the pre-rework one that caused `Malformed response from server`.
- Applying drafts is now covered end to end, which it previously was not at all — hence `Applied 8 tooltips to 0 occurrences` shipping unnoticed. `test_tooltip_suggestion.py` asserts anchors are resolved from the graph when the request carries none, that an entity with an existing note is re-anchored without duplicating the note, and that a draft with no graph subject is reported instead of silently highlighting nothing. `test_ai_html_injection_progress.py` covers a term split by inline markup wrapped into `first/inner/last` parts and a stale anchor skipped without losing the others. `ScholarSuggestionService.test.ts` asserts the client no longer sends an empty occurrence list, and `ScholarSuggestionCommands.test.ts` asserts zero highlights are reported as a warning rather than success.
- Which text may be anchored is pinned where it broke. `test_knowledge_graph_canonical.py` builds occurrences for a paragraph that contains an inline formula and then injects them into the compiled page, so the builder and the injector cannot drift apart; before the fix such a paragraph produced no anchors at all and `KTO` was highlighted nowhere. `test_ai_html_injection_progress.py` asserts an occurrence pointing inside `<math>` is skipped, an anchor left inside a formula by an earlier build is unwrapped so the TeX source returns, and offsets still resolve after a previous batch anchored an earlier word in the same node.
- `TestKnowledgeGraphReanchoring` in `tests/test_api.py` asserts re-anchoring recomputes occurrences from stored observations while keeping subject ids, and refuses a paper without compiled sections. `ScholarContribution.test.ts` asserts the command runs without a confirmation dialog and reports the new count, and `ReaderWorkspaceStore.test.ts` asserts the paper is reloaded afterwards.
- `TestDataIdInjector` and `TestEquationExtraction` in `tests/test_compiler.py` pin the escaping round trip: character references survive `data-id` injection, so LaTeX containing `y_{<t}` is no longer truncated at the first `<`.
- `inlineMath.test.ts` and `EquationLens.test.tsx` cover bare-math wrapping (`y_l`, `y_{i,t}`, punctuation, `snake_case`, already-delimited input) and the location list that replaces the old `Sources` block, including dropping a quote that only repeats the equation.
- The retired `paper_role` label is pinned from both ends: `EquationLens.test.tsx` asserts the lens header holds the equation name alone, and `test_knowledge_graph_models.py` asserts a stored document carrying the old key still validates without it.
- `SemanticDetails.test.tsx` pins the reader-facing wording and chrome of the lens: an `artifact` subject renders its own name with no taxonomy word anywhere in the panel, the location list names the section without repeating that word once per occurrence, and role tags carry `semantic-chip` rather than a Tailwind fill. Three sibling cases read `styles/reader-interactions.css` directly, because contrast and hover rules are invisible to jsdom rendering: chips must be transparent with a border, the edit action must start at `opacity: 0` and be revealed on hover, on keyboard focus, and when the subject has no text, and a disabled action must not dim itself with `opacity`, which would make a hidden button reappear.
- `SemanticDetails.test.tsx` also pins that the lens has a single shell: a term heading and an equation heading carry the same `semantic-lens-title` inside the same `semantic-lens` stack, and no element of the rendered panel carries a Tailwind colour or spacing utility. Two further cases read the stylesheets rather than the DOM: the shared title and body must state `margin: 0`, because the Theia bundle imports Tailwind utilities without preflight and an unreset `h3` is what produced the gap above a term, and the per-branch copies `.equation-lens-title` and `.equation-lens-meaning` must stay deleted, since duplicated rules are how the two halves drifted apart.
- Defining equations are pinned at every boundary: canonicalization maps an exact object observation to `defined_object_id` and drops all ambiguous multi-equation assignments; document validation rejects a missing object or a second defining equation; semantic endpoints project the pair in both directions; and `SemanticDetails.test.tsx` requires the same term definition, formula, and expanded notation whether the term or equation was selected.
- `mise run verify` completes Next.js and Theia browser/Electron builds. Theia reports optional native-module resolution warnings during Electron packaging but finishes all build phases with zero errors.
- Retrieval evaluation promotes no query class; passage-only remains the runtime default.

### High Priority
- [x] InteractiveNode and semantic activation component tests
- [x] Canonical build/API integration and cancellation tests
- [ ] Frontend E2E test (Playwright)
- [x] Bounded graph transform/layout benchmark

### Low Priority
- [x] Semantic/KG malformed-reference, legacy-schema, overlap, and source-drift cases
- [ ] Browser compatibility tests
- [ ] Load testing (concurrent uploads)