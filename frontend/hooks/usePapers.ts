"use client";

import { useState, useCallback } from 'react';
import { apiFetch, API_BASE } from './useApi';

export interface Paper {
  id: string;
  filename: string;
  arxiv_id: string | null;
  title?: string | null;
  uploaded_at: string;
  compiled_at: string | null;
  has_html: boolean;
}

// Section structure from backend (pre-extracted at compile time)
export interface Section {
  id: string;
  title: string;
  title_html: string;
  level: number;
  parent_id: string | null;
  content_html: string;
}

// Equation structure from backend
export interface Equation {
  id: string;
  latex: string | null;
  is_display: boolean;
  mathml: string;
}

// Citation structure from backend
export interface Citation {
  key: string;
  text: string;
  dom_node_id: string | null;
}

// Paper metadata from backend
export interface PaperMetadata {
  title?: string;
  authors?: string[];
  abstract?: string;
}

export interface PaperDetail extends Paper {
  html_content: string | null;
  // Pre-extracted metadata (populated at compile time)
  sections: Section[] | null;
  equations: Equation[] | null;
  citations: Citation[] | null;
  paper_metadata: PaperMetadata | null;
  has_knowledge_graph: boolean;
}


export function usePapers() {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPapers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ papers: Paper[] } | Paper[]>('/api/papers');
      // Handle both array and object response formats
      const paperList = Array.isArray(data) ? data : data.papers || [];
      setPapers(paperList);
    } catch (err: any) {
      setError(err.detail || 'Failed to fetch papers');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPaper = useCallback(async (paperId: string): Promise<PaperDetail | null> => {
    setLoading(true);
    setError(null);
    try {
      const paper = await apiFetch<PaperDetail>(`/api/papers/${paperId}`);
      return paper;
    } catch (err: any) {
      setError(err.detail || 'Failed to fetch paper');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const uploadPaper = useCallback(async (
    file: File,
    compileNow: boolean = true
  ): Promise<Paper | null> => {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('compile_now', compileNow.toString());

      const response = await fetch(`${API_BASE}/api/papers/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Upload failed' }));
        throw { detail: err.detail, status: response.status };
      }

      const paper = await response.json();
      await fetchPapers(); // Refresh the list
      return paper;
    } catch (err: any) {
      setError(err.detail || 'Failed to upload paper');
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchPapers]);

  const uploadArxiv = useCallback(async (
    urlOrId: string,
    compileNow: boolean = true
  ): Promise<Paper | null> => {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('url_or_id', urlOrId);
      formData.append('compile_now', compileNow.toString());

      const response = await fetch(`${API_BASE}/api/papers/upload/arxiv`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'arXiv fetch failed' }));
        throw { detail: err.detail, status: response.status };
      }

      const paper = await response.json();
      await fetchPapers(); // Refresh the list
      return paper;
    } catch (err: any) {
      setError(err.detail || 'Failed to fetch from arXiv');
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchPapers]);

  const compilePaper = useCallback(async (paperId: string): Promise<Paper | null> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/papers/${paperId}/compile`, {
        method: 'POST',
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Compilation failed' }));
        throw { detail: err.detail, status: response.status };
      }

      const paper = await response.json();
      await fetchPapers(); // Refresh the list
      return paper;
    } catch (err: any) {
      setError(err.detail || 'Failed to compile paper');
      return null;
    } finally {
      setLoading(false);
    }
  }, [fetchPapers]);

  const deletePaper = useCallback(async (paperId: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/papers/${paperId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Delete failed' }));
        throw { detail: err.detail, status: response.status };
      }

      await fetchPapers(); // Refresh the list
      return true;
    } catch (err: any) {
      setError(err.detail || 'Failed to delete paper');
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchPapers]);

  return {
    papers,
    loading,
    error,
    fetchPapers,
    fetchPaper,
    uploadPaper,
    uploadArxiv,
    compilePaper,
    deletePaper,
    clearError: () => setError(null),
  };
}

export default usePapers;
