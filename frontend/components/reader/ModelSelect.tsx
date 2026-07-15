'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { componentStyles, textStyles } from '@/lib/design-system';

interface ModelOption {
  id: string;
  name: string;
}

interface ModelSelectProps {
  value: string;
  options: ModelOption[];
  placeholder?: string;
  onChange: (value: string) => void;
}

/**
 * Combobox: free-text input with a real dropdown of suggestions.
 * - Type any model name manually
 * - Click the chevron (or focus + type) to see and pick from suggestions
 * - Selected value is highlighted in the dropdown
 */
export function ModelSelect({ value, options, placeholder, onChange }: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Filtered options based on what user typed in the dropdown filter
  const filtered = options.filter((m) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return m.id.toLowerCase().includes(f) || m.name.toLowerCase().includes(f);
  });

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
    setFilter('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && open && filtered.length > 0) {
      e.preventDefault();
      // Select first match if filter is active, or keep typed value
      if (filter) {
        handleSelect(filtered[0].id);
      } else {
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setFilter('');
    }
  };

  const hasOptions = options.length > 0;

  return (
    <div className="relative flex-1" ref={ref}>
      <div className="flex">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => hasOptions && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || 'Type or select a model...'}
          className={componentStyles.input.default + ' rounded-r-none'}
        />
        {hasOptions && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex-shrink-0 px-3 border border-l-0 border-slate-300 rounded-r-md bg-slate-50 hover:bg-slate-100 text-slate-500 transition-colors"
            title={open ? 'Close suggestions' : 'Show suggestions'}
          >
            <ChevronDown
              size={16}
              className={`transition-transform ${open ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {open && hasOptions && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {/* Filter input inside dropdown */}
          <div className="p-2 border-b border-slate-100 sticky top-0 bg-white">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Filter models..."
              autoFocus
              className="w-full text-sm px-2 py-1.5 border border-slate-200 rounded text-slate-700 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>

          {/* Options */}
          {filtered.length > 0 ? (
            filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelect(m.id)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors flex items-center justify-between gap-2 ${
                  value === m.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700'
                }`}
              >
                <span className="truncate">{m.id}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {m.name !== m.id && (
                    <span className="text-xs text-slate-600">{m.name}</span>
                  )}
                  {value === m.id && <Check size={14} className="text-indigo-600" />}
                </div>
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-sm text-slate-600 text-center">
              No models match &ldquo;{filter}&rdquo;. Press Enter to use your typed value.
            </div>
          )}

          {/* Footer hint */}
          <div className="px-3 py-1.5 border-t border-slate-100 text-xs text-slate-600 bg-slate-50 rounded-b-lg">
            {options.length} model{options.length !== 1 ? 's' : ''} available · type to filter or enter custom name
          </div>
        </div>
      )}
    </div>
  );
}