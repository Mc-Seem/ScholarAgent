"use client";

import { useState, useEffect, useCallback } from 'react';
import { apiFetch, API_BASE } from './useApi';

export interface Tooltip {
  id: string;
  paper_id: string;
  dom_node_id: string | null;
  entity_id?: string | null;  // For glossary tooltips (entity-based)
  user_id: string;
  target_text?: string | null;
  content: string;
  /** True only when the reader replaced the graph's wording in Semantic Lens. */
  is_user_override?: boolean;
  is_pinned: boolean;
  display_order?: number | null;
  created_at: string;
  updated_at: string;
}

export interface TooltipMap {
  [domNodeId: string]: Tooltip[];
}

export interface EntityTooltipMap {
  [entityId: string]: Tooltip;
}

export function useTooltips(paperId: string | null) {
  const [tooltips, setTooltips] = useState<Tooltip[]>([]);
  const [tooltipMap, setTooltipMap] = useState<TooltipMap>({});
  const [entityTooltipMap, setEntityTooltipMap] = useState<EntityTooltipMap>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build maps for O(1) lookups
  useEffect(() => {
    const domMap: TooltipMap = {};
    const entityMap: EntityTooltipMap = {};

    tooltips.forEach(t => {
      // Map dom_node_id -> tooltips[] (for comments)
      if (t.dom_node_id) {
        if (!domMap[t.dom_node_id]) {
          domMap[t.dom_node_id] = [];
        }
        domMap[t.dom_node_id].push(t);
      }

      // Map entity_id -> tooltip (for glossary/semantic tooltips)
      if (t.entity_id) {
        entityMap[t.entity_id] = t;
      }
    });

    setTooltipMap(domMap);
    setEntityTooltipMap(entityMap);
  }, [tooltips]);

  const fetchTooltips = useCallback(async () => {
    if (!paperId) {
      setTooltips([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Tooltip[] | { tooltips: Tooltip[] }>(`/api/papers/${paperId}/tooltips`);
      const tooltipList = Array.isArray(data) ? data : data.tooltips || [];
      setTooltips(tooltipList);
    } catch (err: any) {
      setError(err.detail || 'Failed to fetch tooltips');
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  // Fetch tooltips when paperId changes
  useEffect(() => {
    fetchTooltips();
  }, [fetchTooltips]);

  const createTooltip = useCallback(async (
    domNodeId: string,
    content: string,
    targetText?: string
  ): Promise<Tooltip | null> => {
    if (!paperId) return null;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/papers/${paperId}/tooltips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dom_node_id: domNodeId,
          content,
          target_text: targetText || null
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Create failed' }));
        throw { detail: err.detail, status: response.status };
      }

      const newTooltip = await response.json();

      // Update local state - always add (support multiple per node)
      setTooltips(prev => [...prev, newTooltip]);

      return newTooltip;
    } catch (err: any) {
      setError(err.detail || 'Failed to create tooltip');
      return null;
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  const updateTooltip = useCallback(async (
    tooltipId: string,
    content: string,
    targetText?: string,
    isPinned?: boolean,
    displayOrder?: number
  ): Promise<Tooltip | null> => {
    if (!paperId) return null;

    setLoading(true);
    setError(null);
    try {
      const body: any = { content, target_text: targetText };
      if (isPinned !== undefined) body.is_pinned = isPinned;
      if (displayOrder !== undefined) body.display_order = displayOrder;

      const response = await fetch(`${API_BASE}/api/papers/${paperId}/tooltips/${tooltipId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Update failed' }));
        throw { detail: err.detail, status: response.status };
      }

      const updatedTooltip = await response.json();

      // Update local state
      setTooltips(prev => prev.map(t =>
        t.id === tooltipId ? updatedTooltip : t
      ));

      return updatedTooltip;
    } catch (err: any) {
      setError(err.detail || 'Failed to update tooltip');
      return null;
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  const deleteTooltip = useCallback(async (tooltipId: string): Promise<boolean> => {
    if (!paperId) return false;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/papers/${paperId}/tooltips/${tooltipId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Delete failed' }));
        throw { detail: err.detail, status: response.status };
      }

      // Update local state
      setTooltips(prev => prev.filter(t => t.id !== tooltipId));
      return true;
    } catch (err: any) {
      setError(err.detail || 'Failed to delete tooltip');
      return false;
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  const removeTooltipOccurrence = useCallback(async (
    tooltipId: string,
    domNodeId: string
  ): Promise<boolean> => {
    if (!paperId) {
      console.log('[useTooltips] No paperId, returning false');
      return false;
    }

    console.log('[useTooltips] removeTooltipOccurrence called:', { paperId, tooltipId, domNodeId });

    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/papers/${paperId}/tooltips/${tooltipId}/occurrences/${domNodeId}`;
      console.log('[useTooltips] Fetching URL:', url);

      const response = await fetch(url, { method: 'DELETE' });

      console.log('[useTooltips] Response status:', response.status);

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: 'Remove occurrence failed' }));
        console.error('[useTooltips] Error response:', err);
        throw { detail: err.detail, status: response.status };
      }

      const result = await response.json();
      console.log('[useTooltips] Success response:', result);

      return true;
    } catch (err: any) {
      console.error('[useTooltips] Exception:', err);
      setError(err.detail || 'Failed to remove tooltip occurrence');
      return false;
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  return {
    tooltips,
    tooltipMap,
    entityTooltipMap,
    loading,
    error,
    fetchTooltips,
    createTooltip,
    updateTooltip,
    deleteTooltip,
    removeTooltipOccurrence,
    clearError: () => setError(null),
  };
}

export default useTooltips;
