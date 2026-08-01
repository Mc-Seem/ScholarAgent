import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import NavigationPanel from '@/components/reader/NavigationPanel'
import type { SemanticApi, SemanticSelection } from '@/lib/semantic-api'

vi.mock('@/components/reader/TableOfContents', () => ({
  default: () => <div>Table of contents</div>,
}))

vi.mock('@/components/reader/KnowledgeGraphView', () => ({
  KnowledgeGraphView: () => <div>Knowledge graph</div>,
}))

const selection: SemanticSelection = {
  kind: 'occurrence',
  occurrenceId: 'occ-1',
  subjectId: 'procedure:supg',
  label: 'SUPG',
  subjectKind: 'procedure',
  domNodeId: 'p-1',
  scopeId: 'sec-1',
}

const semanticApi: SemanticApi = {
  sectionAnnotations: vi.fn(),
  subjectDetails: vi.fn().mockResolvedValue({
    schema_version: '3.0',
    subject: {
      stable_id: 'procedure:supg',
      kind: 'procedure',
      label: 'SUPG',
      aliases: [],
      roles: ['main_contribution'],
      facets: [],
      units: null,
      constraints: [],
      object_ids: [],
    },
    explanation: {
      stable_id: 'explanation:supg',
      subject_id: 'procedure:supg',
      base_content: 'A stabilized finite element procedure.',
      expertise: 'intermediate',
      evidence_ids: ['obs-1'],
    },
    occurrences: [],
    evidence: [],
    occurrence_total: 2,
  }),
  equationDetails: vi.fn(),
  glossary: vi.fn().mockResolvedValue({
    schema_version: '3.0',
    results: [{
      subject_id: 'notation:tau',
      kind: 'notation',
      label: 'tau',
      aliases: [],
      explanation: 'Stabilization parameter',
      evidence_ids: ['obs-equation'],
    }],
    total: 1,
    offset: 0,
    limit: 30,
  }),
}

describe('NavigationPanel semantic details', () => {
  it('opens explicit semantic selection and returns to the previous mode', async () => {
    const onSemanticSelect = vi.fn()
    render(
      <NavigationPanel
        paperId="paper-1"
        toc={[]}
        semanticSelection={selection}
        onSemanticSelect={onSemanticSelect}
        semanticApi={semanticApi}
      />,
    )

    expect(await screen.findByText('A stabilized finite element procedure.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /back/i }))

    expect(screen.getByText('Table of contents')).toBeVisible()
    expect(onSemanticSelect).toHaveBeenCalledWith(null)
  })

  it('does not auto-open details when embedded in a split layout', () => {
    render(
      <NavigationPanel
        paperId="paper-1"
        toc={[]}
        semanticSelection={selection}
        semanticApi={semanticApi}
        autoOpenDetails={false}
      />,
    )

    expect(screen.queryByTestId('semantic-details')).not.toBeInTheDocument()
    expect(screen.getByText('Table of contents')).toBeVisible()
  })

  it('searches glossary without inserting results into the graph', async () => {
    render(<NavigationPanel paperId="paper-1" toc={[]} semanticApi={semanticApi} />)

    fireEvent.click(screen.getByRole('button', { name: /glossary/i }))
    fireEvent.change(screen.getByPlaceholderText('Search terms and notation'), {
      target: { value: 'tau' },
    })

    await waitFor(() => expect(semanticApi.glossary).toHaveBeenCalledWith('paper-1', 'tau', 30))
    expect(await screen.findByText('Stabilization parameter')).toBeInTheDocument()
    expect(screen.getByText('Knowledge graph').parentElement).toHaveClass('hidden')
  })
})