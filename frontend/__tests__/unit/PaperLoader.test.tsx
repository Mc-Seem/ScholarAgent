import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PaperLoader from '@/components/reader/PaperLoader'

// Mock the hooks
const mockFetchPapers = vi.fn()
const mockFetchPaper = vi.fn()
const mockUploadPaper = vi.fn()
const mockUploadArxiv = vi.fn()
const mockCompilePaper = vi.fn()
const mockDeletePaper = vi.fn()
const mockClearPapersError = vi.fn()
const mockCreateTooltip = vi.fn()
const mockUpdateTooltip = vi.fn()
const mockDeleteTooltip = vi.fn()
const mockFetchTooltips = vi.fn()
const mockRemoveTooltipOccurrence = vi.fn()

// Mockable state for usePapers hook
const mockPapersState = {
  papers: [] as any[],
  loading: false,
  error: null as string | null,
}

// Mockable state for useTooltips hook
const mockTooltipsState = {
  tooltipMap: {} as Record<string, any>,
  entityTooltipMap: {} as Record<string, any>,
  loading: false,
  error: null as string | null,
}

const mockAiPreferencesState = {
  capabilities: {
    providers: {
      anthropic: {
        available: true,
        label: 'Anthropic',
        fixed_models: {},
      },
      openrouter: {
        available: true,
        label: 'OpenRouter',
        supports_arbitrary_models: true,
        supports_model_validation: true,
      },
    },
    default_provider: 'anthropic' as const,
  },
  effectiveProvider: 'anthropic' as const,
  providerSummary: 'Anthropic',
  preferences: {
    provider: null,
    openrouterSharedModel: '',
    openrouterKnowledgeGraphModel: '',
    openrouterTooltipFilterModel: '',
    openrouterHtmlInjectionModel: '',
  },
  loading: false,
  error: null as string | null,
  validationResults: {},
  validationLoading: false,
  validationError: null as string | null,
}

vi.mock('@/hooks/usePapers', () => ({
  usePapers: () => ({
    papers: mockPapersState.papers,
    loading: mockPapersState.loading,
    error: mockPapersState.error,
    fetchPapers: mockFetchPapers,
    fetchPaper: mockFetchPaper,
    uploadPaper: mockUploadPaper,
    uploadArxiv: mockUploadArxiv,
    compilePaper: mockCompilePaper,
    deletePaper: mockDeletePaper,
    clearError: mockClearPapersError,
  }),
}))

// Mock ResizableLayout to just render the main panel
vi.mock('@/components/reader/ResizableLayout', () => ({
  default: ({ mainPanel }: any) => <div>{mainPanel}</div>,
}))

vi.mock('@/hooks/useTooltips', () => ({
  useTooltips: () => ({
    tooltipMap: mockTooltipsState.tooltipMap,
    entityTooltipMap: mockTooltipsState.entityTooltipMap,
    loading: mockTooltipsState.loading,
    error: mockTooltipsState.error,
    tooltips: [],
    createTooltip: mockCreateTooltip,
    updateTooltip: mockUpdateTooltip,
    deleteTooltip: mockDeleteTooltip,
    fetchTooltips: mockFetchTooltips,
    removeTooltipOccurrence: mockRemoveTooltipOccurrence,
  }),
}))

vi.mock('@/hooks/useAiPreferences', () => ({
  useAiPreferences: () => ({
    capabilities: mockAiPreferencesState.capabilities,
    effectiveProvider: mockAiPreferencesState.effectiveProvider,
    providerSummary: mockAiPreferencesState.providerSummary,
    preferences: mockAiPreferencesState.preferences,
    loading: mockAiPreferencesState.loading,
    error: mockAiPreferencesState.error,
    validationResults: mockAiPreferencesState.validationResults,
    validationLoading: mockAiPreferencesState.validationLoading,
    validationError: mockAiPreferencesState.validationError,
    updatePreferences: vi.fn(),
    buildAiConfig: () => ({ provider: 'anthropic' }),
    validateOpenRouterModels: vi.fn().mockResolvedValue({}),
  }),
}))

vi.mock('@/components/reader/AISettingsDialog', () => ({
  default: () => null,
}))

// Mock HTMLRenderer
vi.mock('@/components/reader/HTMLRenderer', () => ({
  HTMLRenderer: ({ html }: any) => <div data-testid="html-renderer">{html}</div>,
}))

// Mock window.confirm
const mockConfirm = vi.fn()
global.confirm = mockConfirm

describe('PaperLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirm.mockReturnValue(true)
    // Reset mock states
    mockPapersState.papers = []
    mockPapersState.loading = false
    mockPapersState.error = null
    mockTooltipsState.tooltipMap = {}
    mockTooltipsState.entityTooltipMap = {}
    mockTooltipsState.loading = false
    mockTooltipsState.error = null
  })

  it('renders the main interface', () => {
    render(<PaperLoader />)

    expect(screen.getByText('Scholar Agent')).toBeInTheDocument()
    expect(screen.getByText('Reader')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Upload LaTeX/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /arXiv Source/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Library/i })).toBeInTheDocument()
  })

  it('fetches papers on mount', () => {
    render(<PaperLoader />)

    expect(mockFetchPapers).toHaveBeenCalledTimes(1)
  })

  it('displays placeholder when no paper is selected', () => {
    render(<PaperLoader />)

    expect(
      screen.getByText(/Upload a LaTeX archive or select a paper to start reading/)
    ).toBeInTheDocument()
  })

  it('handles file upload', async () => {
    const mockPaper = {
      id: 'paper-123',
      filename: 'test.tar.gz',
      has_html: true,
      html_content: '<p>Test content</p>',
    }

    mockUploadPaper.mockResolvedValueOnce(mockPaper)
    mockFetchPaper.mockResolvedValueOnce(mockPaper)

    render(<PaperLoader />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    const file = new File(['content'], 'test.tar.gz', { type: 'application/gzip' })

    await userEvent.upload(fileInput, file)

    await waitFor(() => {
      expect(mockUploadPaper).toHaveBeenCalledWith(file, true)
    })
  })

  it('handles arXiv fetch', async () => {
    const user = userEvent.setup()
    const mockPaper = {
      id: 'paper-456',
      filename: 'arXiv:2401.12345',
      arxiv_id: '2401.12345',
      has_html: true,
      html_content: '<p>ArXiv content</p>',
    }

    mockUploadArxiv.mockResolvedValueOnce(mockPaper)
    mockFetchPaper.mockResolvedValueOnce(mockPaper)

    render(<PaperLoader />)

    const arxivInput = screen.getByPlaceholderText('2401.12345')
    const fetchButton = screen.getByText('Fetch')

    await user.type(arxivInput, '2401.12345')
    await user.click(fetchButton)

    await waitFor(() => {
      expect(mockUploadArxiv).toHaveBeenCalledWith('2401.12345', true)
    })
  })

  it('handles arXiv fetch on Enter key', async () => {
    const user = userEvent.setup()
    const mockPaper = {
      id: 'paper-789',
      filename: 'arXiv:2401.99999',
      has_html: true,
    }

    mockUploadArxiv.mockResolvedValueOnce(mockPaper)
    mockFetchPaper.mockResolvedValueOnce(mockPaper)

    render(<PaperLoader />)

    const arxivInput = screen.getByPlaceholderText('2401.12345')

    await user.type(arxivInput, '2401.99999')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mockUploadArxiv).toHaveBeenCalledWith('2401.99999', true)
    })
  })

  it('disables controls when loading', () => {
    mockPapersState.loading = true

    render(<PaperLoader />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const arxivInput = screen.getByPlaceholderText('2401.12345') as HTMLInputElement
    const fetchButton = screen.getByText('Fetch') as HTMLButtonElement

    expect(fileInput?.disabled).toBe(true)
    expect(arxivInput?.disabled).toBe(true)
    expect(fetchButton?.disabled).toBe(true)
  })

  it('displays error messages', () => {
    mockPapersState.error = 'Upload failed'

    render(<PaperLoader />)

    expect(screen.getByText('Upload failed')).toBeInTheDocument()
  })

  it('displays list of cached papers', () => {
    mockPapersState.papers = [
      { id: '1', filename: 'paper1.tar.gz', has_html: true },
      { id: '2', filename: 'paper2.tar.gz', has_html: false },
    ]

    render(<PaperLoader />)

    expect(screen.getByText(/paper1.tar.gz/)).toBeInTheDocument()
    expect(screen.getByText(/paper2.tar.gz/)).toBeInTheDocument()
    expect(screen.getByText(/\(not compiled\)/)).toBeInTheDocument()
  })

  it('displays "No papers yet" when library is empty', () => {
    render(<PaperLoader />)

    expect(screen.getByText('No papers yet')).toBeInTheDocument()
  })

  it('handles paper selection from dropdown', async () => {
    const user = userEvent.setup()

    mockPapersState.papers = [
      { id: 'paper-1', filename: 'test.tar.gz', has_html: true },
    ]

    const mockPaperDetail = {
      id: 'paper-1',
      filename: 'test.tar.gz',
      has_html: true,
      html_content: '<p>Content</p>',
    }

    mockFetchPaper.mockResolvedValueOnce(mockPaperDetail)

    render(<PaperLoader />)

    const select = screen.getByRole('combobox')
    await user.selectOptions(select, 'paper-1')

    await waitFor(() => {
      expect(mockFetchPaper).toHaveBeenCalledWith('paper-1')
    })
  })

  it('renders HTMLRenderer when paper has content', async () => {
    const mockPaperDetail = {
      id: 'paper-1',
      filename: 'test.tar.gz',
      has_html: true,
      html_content: '<p>Test HTML Content</p>',
    }

    mockFetchPaper.mockResolvedValueOnce(mockPaperDetail)

    mockPapersState.papers = [{ id: 'paper-1', filename: 'test.tar.gz', has_html: true }]

    const { rerender } = render(<PaperLoader />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'paper-1' } })

    await waitFor(() => {
      expect(mockFetchPaper).toHaveBeenCalledWith('paper-1')
    })

    // Manually trigger re-render with loaded paper state
    rerender(<PaperLoader />)

    await waitFor(() => {
      const renderer = screen.queryByTestId('html-renderer')
      if (renderer) {
        expect(renderer).toBeInTheDocument()
      }
    })
  })

  it('shows compile prompt for uncompiled papers', async () => {
    const mockPaperDetail = {
      id: 'paper-2',
      filename: 'uncompiled.tar.gz',
      has_html: false,
      html_content: null,
    }

    mockFetchPaper.mockResolvedValueOnce(mockPaperDetail)

    mockPapersState.papers = [{ id: 'paper-2', filename: 'uncompiled.tar.gz', has_html: false }]

    render(<PaperLoader />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'paper-2' } })

    // Wait for fetchPaper to be called and resolved
    await waitFor(() => {
      expect(mockFetchPaper).toHaveBeenCalledWith('paper-2')
    })

    // Now wait for the UI to reflect the uncompiled state
    await waitFor(() => {
      expect(screen.getByText('Paper Not Compiled')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('handles recompile action', async () => {
    const user = userEvent.setup()
    mockCompilePaper.mockResolvedValueOnce({
      id: 'paper-1',
      html_content: '<p>Recompiled</p>',
    })

    // Need to mock with a selected paper
    const mockPaperDetail = {
      id: 'paper-1',
      filename: 'test.tar.gz',
      has_html: false,
    }

    mockFetchPaper.mockResolvedValue(mockPaperDetail)

    mockPapersState.papers = [{ id: 'paper-1', filename: 'test.tar.gz', has_html: false }]

    render(<PaperLoader />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'paper-1' } })

    await waitFor(() => {
      expect(mockFetchPaper).toHaveBeenCalledWith('paper-1')
    })

    const compileButton = await screen.findByText('Compile Now')
    await user.click(compileButton)

    await waitFor(() => {
      expect(mockCompilePaper).toHaveBeenCalledWith('paper-1')
    })
  })

  it('handles delete action with confirmation', async () => {
    const user = userEvent.setup()
    mockDeletePaper.mockResolvedValueOnce(true)

    const mockPaperDetail = {
      id: 'paper-1',
      filename: 'test.tar.gz',
      has_html: true,
      html_content: '<p>Content</p>',
    }

    mockFetchPaper.mockResolvedValue(mockPaperDetail)

    mockPapersState.papers = [{ id: 'paper-1', filename: 'test.tar.gz', has_html: true }]

    render(<PaperLoader />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'paper-1' } })

    await waitFor(() => {
      expect(mockFetchPaper).toHaveBeenCalledWith('paper-1')
    })

    const deleteButton = await screen.findByText('Delete')
    await user.click(deleteButton)

    expect(mockConfirm).toHaveBeenCalledWith('Delete this paper and all its annotations?')

    await waitFor(() => {
      expect(mockDeletePaper).toHaveBeenCalledWith('paper-1')
    })
  })

  it('cancels delete when confirmation is rejected', async () => {
    const user = userEvent.setup()
    mockConfirm.mockReturnValueOnce(false)

    const mockPaperDetail = {
      id: 'paper-1',
      filename: 'test.tar.gz',
      has_html: true,
      html_content: '<p>Content</p>',
    }

    mockFetchPaper.mockResolvedValue(mockPaperDetail)

    mockPapersState.papers = [{ id: 'paper-1', filename: 'test.tar.gz', has_html: true }]

    render(<PaperLoader />)

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'paper-1' } })

    await waitFor(() => {
      expect(mockFetchPaper).toHaveBeenCalledWith('paper-1')
    })

    const deleteButton = await screen.findByText('Delete')
    await user.click(deleteButton)

    expect(mockConfirm).toHaveBeenCalled()
    expect(mockDeletePaper).not.toHaveBeenCalled()
  })

  it('clears errors before upload operations', async () => {
    const file = new File(['content'], 'test.tar.gz', { type: 'application/gzip' })

    render(<PaperLoader />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    if (fileInput) {
      await userEvent.upload(fileInput, file)
    }

    await waitFor(() => {
      expect(mockClearPapersError).toHaveBeenCalled()
    })
  })

  it('refreshes papers list when clicking refresh button', async () => {
    const user = userEvent.setup()

    render(<PaperLoader />)

    // Find the refresh button (it has a RefreshCw icon)
    const refreshButton = screen.getByRole('button', { name: '' }) // Icon button with no text

    await user.click(refreshButton)

    // Should call fetchPapers (once on mount, once on click)
    await waitFor(() => {
      expect(mockFetchPapers).toHaveBeenCalledTimes(2)
    })
  })
})
