'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import { Panel, Group, Separator } from 'react-resizable-panels';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { ChevronLeft, ChevronRight, Menu, SidebarClose, User, X, RotateCcw } from 'lucide-react';

interface ResizableLayoutProps {
  leftPanel: ReactNode;
  mainPanel: ReactNode;
  rightPanel: ReactNode;
  onExpertiseChange?: (expertise: string) => void;
  onOpenAiSettings?: () => void;
  aiSettingsSummary?: string;
  aiSettingsDisabled?: boolean;
}

const STORAGE_KEYS = {
  LEFT_COLLAPSED: 'reader-left-panel-collapsed',
  RIGHT_COLLAPSED: 'reader-right-panel-collapsed',
  EXPERTISE: 'scholar-agent-expertise',
};

const DEFAULT_EXPERTISE = "I have a general STEM background with basic understanding of mathematical notation and common scientific concepts.";

export default function ResizableLayout({
  leftPanel,
  mainPanel,
  rightPanel,
  onExpertiseChange,
  onOpenAiSettings,
  aiSettingsSummary,
  aiSettingsDisabled,
}: ResizableLayoutProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [showExpertiseModal, setShowExpertiseModal] = useState(false);
  const [expertise, setExpertise] = useState<string>(DEFAULT_EXPERTISE);

  const leftPanelRef = useRef<PanelImperativeHandle>(null);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);

  // Load collapse state and expertise from localStorage on mount
  useEffect(() => {
    const storedLeftCollapsed = localStorage.getItem(STORAGE_KEYS.LEFT_COLLAPSED);
    const storedRightCollapsed = localStorage.getItem(STORAGE_KEYS.RIGHT_COLLAPSED);
    const storedExpertise = localStorage.getItem(STORAGE_KEYS.EXPERTISE);

    if (storedLeftCollapsed === 'true') {
      setLeftCollapsed(true);
      leftPanelRef.current?.collapse();
    }
    if (storedRightCollapsed === 'true') {
      setRightCollapsed(true);
      rightPanelRef.current?.collapse();
    }
    if (storedExpertise) {
      setExpertise(storedExpertise);
      onExpertiseChange?.(storedExpertise);
    } else {
      onExpertiseChange?.(DEFAULT_EXPERTISE);
    }
  }, [onExpertiseChange]);

  const toggleLeftPanel = () => {
    const newState = !leftCollapsed;
    if (newState) {
      // Collapsing
      leftPanelRef.current?.collapse();
    } else {
      // Expanding
      leftPanelRef.current?.expand();
    }
    setLeftCollapsed(newState);
    localStorage.setItem(STORAGE_KEYS.LEFT_COLLAPSED, String(newState));
  };

  const toggleRightPanel = () => {
    const newState = !rightCollapsed;
    if (newState) {
      // Collapsing
      rightPanelRef.current?.collapse();
    } else {
      // Expanding
      rightPanelRef.current?.expand();
    }
    setRightCollapsed(newState);
    localStorage.setItem(STORAGE_KEYS.RIGHT_COLLAPSED, String(newState));
  };

  const handleSaveExpertise = () => {
    localStorage.setItem(STORAGE_KEYS.EXPERTISE, expertise);
    onExpertiseChange?.(expertise);
    setShowExpertiseModal(false);
  };

  const handleResetExpertise = () => {
    setExpertise(DEFAULT_EXPERTISE);
    localStorage.setItem(STORAGE_KEYS.EXPERTISE, DEFAULT_EXPERTISE);
    onExpertiseChange?.(DEFAULT_EXPERTISE);
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Top toolbar with panel toggles */}
      <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2">
          <button
            onClick={toggleLeftPanel}
            className="p-1.5 rounded text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            title={leftCollapsed ? 'Show navigation' : 'Hide navigation'}
          >
            {leftCollapsed ? <Menu size={18} /> : <SidebarClose size={18} />}
          </button>
          <span className="text-sm text-slate-600 font-medium">
            Scholar Agent Reader
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onOpenAiSettings && (
            <button
              onClick={onOpenAiSettings}
              disabled={aiSettingsDisabled}
              className="rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              title="AI settings"
            >
              {aiSettingsSummary && (
                <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition-colors hover:bg-indigo-200">
                  {aiSettingsSummary}
                </span>
              )}
            </button>
          )}
          <button
            onClick={() => setShowExpertiseModal(true)}
            className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
          >
            <User size={14} />
            <span>Personalize</span>
          </button>
          <button
            onClick={toggleRightPanel}
            className="p-1.5 rounded text-slate-600 hover:text-slate-800 hover:bg-slate-100 transition-colors"
            title={rightCollapsed ? 'Show tooltips' : 'Hide tooltips'}
          >
            {rightCollapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </div>

      {/* Main resizable layout */}
      <div className="flex-1 overflow-hidden">
        <Group
          orientation="horizontal"
          style={{ height: '100%', width: '100%' }}
          id="reader-panel-group"
        >
        {/* Left Panel - Navigation */}
        <Panel
          id="left-panel"
          panelRef={leftPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={20}
          minSize={10}
          className="bg-white border-r border-slate-200"
        >
          {!leftCollapsed && (
            <div className="h-full overflow-hidden">
              {leftPanel}
            </div>
          )}
        </Panel>

        <Separator className="w-1 bg-slate-200 hover:bg-indigo-400 transition-colors cursor-col-resize" />

        {/* Middle Panel - Main Content */}
        <Panel id="main-panel" defaultSize={55} minSize={30} className="bg-slate-50">
          <div className="h-full overflow-y-auto">
            {mainPanel}
          </div>
        </Panel>

        <Separator className="w-1 bg-slate-200 hover:bg-indigo-400 transition-colors cursor-col-resize" />

        {/* Right Panel - Tooltips */}
        <Panel
          id="right-panel"
          panelRef={rightPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={25}
          minSize={15}
          className="bg-white border-l border-slate-200"
        >
          {!rightCollapsed && (
            <div className="h-full overflow-hidden">
              {rightPanel}
            </div>
          )}
        </Panel>
      </Group>
      </div>

      {/* Expertise Modal */}
      {showExpertiseModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowExpertiseModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <User size={20} />
                Personalize Tooltips
              </h3>
              <button
                onClick={() => setShowExpertiseModal(false)}
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
                onClick={handleResetExpertise}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <RotateCcw size={14} />
                Reset
              </button>
              <button
                onClick={() => setShowExpertiseModal(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveExpertise}
                disabled={!expertise.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
