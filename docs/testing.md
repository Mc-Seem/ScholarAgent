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

### High Priority
- [ ] InteractiveNode component tests
- [ ] Full pipeline integration test
- [ ] Frontend E2E test (Playwright)
- [ ] Performance benchmarks

### Low Priority
- [ ] Edge case handling (malformed inputs)
- [ ] Browser compatibility tests
- [ ] Load testing (concurrent uploads)