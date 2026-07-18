'use client';

import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { DEFAULT_USER_EXPERTISE } from '../../lib/user-expertise';

interface SuggestTooltipsButtonProps {
  disabled?: boolean;
  loading?: boolean;
  onSuggest: (expertise: string) => void;
}

export default function SuggestTooltipsButton({
  disabled,
  loading,
  onSuggest,
}: SuggestTooltipsButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [expertise, setExpertise] = useState<string>(DEFAULT_USER_EXPERTISE);

  const handleSuggest = () => {
    onSuggest(expertise.trim());
    setShowModal(false);
  };

  return (
    <>
      {/* Toolbar Button */}
      <button
        onClick={() => setShowModal(true)}
        disabled={disabled || loading}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Sparkles size={12} />
        {loading ? 'Suggesting...' : 'Suggest Tooltips'}
      </button>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Suggest Tooltips</h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-2">
                  Your Background
                </label>
                <textarea
                  value={expertise}
                  onChange={(e) => setExpertise(e.target.value)}
                  placeholder="Describe your expertise and what concepts you're familiar with..."
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  rows={4}
                />
              </div>
              <p className="text-xs text-slate-500">
                The AI will suggest annotations for terms that might be unfamiliar based on your background.
              </p>
            </div>

            {/* Footer */}
            <div className="flex gap-2 p-4 border-t border-slate-200">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSuggest}
                disabled={!expertise.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate Suggestions
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
