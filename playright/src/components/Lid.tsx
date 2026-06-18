import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@clerk/react';
import { Library, Music2, Pause, Play, RotateCcw, Settings, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { parseMusicXmlToScript } from '../core/parser/index.ts';
import { predictFingering } from '../core/fingeringPredictor.ts';
import { practiceEngine } from '../core/PracticeEngine.ts';
import { readMusicXmlFromFile, titleFromFileName } from '../core/readScoreFile.ts';
import { fetchScoreById, saveScoreToLibrary } from '../core/scoreLibrary.ts';
import { useEngineStore, type HandSpanPreset, type ShiftMode, type SheetScrollMode, HAND_SPAN_PRESETS } from '../store/useEngineStore.ts';
import type { Hand } from '../types/index.ts';
import { SHIFT_MODE_LABELS } from '../core/shiftMode.ts';
import { ScoreLibraryPanel } from './ScoreLibraryPanel.tsx';
import { ShortcutsMenu } from './ShortcutsMenu.tsx';
import { AccountSection } from './AccountSection.tsx';

export function Lid() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMenuPosition, setSettingsMenuPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const collapsed = useEngineStore((state) => state.headerCollapsed);
  const toggleHeaderCollapsed = useEngineStore(
    (state) => state.actions.toggleHeaderCollapsed,
  );
  const { isLoaded: isAuthLoaded, isSignedIn, userId } = useAuth();
  const songTitle = useEngineStore((state) => state.songTitle);
  const script = useEngineStore((state) => state.script);
  const isPracticeActive = useEngineStore((state) => state.isPracticeActive);
  const hasPracticeStarted = useEngineStore((state) => state.hasPracticeStarted);
  const shiftMode = useEngineStore((state) => state.shiftMode);
  const sheetScrollMode = useEngineStore((state) => state.sheetScrollMode);
  const autoFingering = useEngineStore((state) => state.autoFingering);
  const handSpan = useEngineStore((state) => state.handSpan);
  const engineMode = useEngineStore((state) => state.engineMode);
  const activeHand = useEngineStore((state) => state.activeHand);
  const loadScript = useEngineStore((state) => state.actions.loadScript);
  const setShiftMode = useEngineStore((state) => state.actions.setShiftMode);
  const setSheetScrollMode = useEngineStore((state) => state.actions.setSheetScrollMode);
  const setAutoFingering = useEngineStore((state) => state.actions.setAutoFingering);
  const setHandSpan = useEngineStore((state) => state.actions.setHandSpan);
  const setEngineMode = useEngineStore((state) => state.actions.setEngineMode);

  const prepareScriptForLoad = (script: ReturnType<typeof parseMusicXmlToScript>) => {
    const state = useEngineStore.getState();
    return state.autoFingering
      ? predictFingering(script, { spanScale: state.handSpan })
      : script;
  };

  const handSpanClass = (preset: HandSpanPreset) =>
    handSpan === preset
      ? 'bg-violet-600 text-white'
      : 'text-zinc-400 hover:text-zinc-200';

  const canManageLibrary = isAuthLoaded && isSignedIn && Boolean(userId);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        settingsRef.current?.contains(target) ||
        settingsPanelRef.current?.contains(target)
      ) {
        return;
      }

      setSettingsOpen(false);
    };

    window.addEventListener('click', handleOutsideClick);

    return () => {
      window.removeEventListener('click', handleOutsideClick);
    };
  }, [settingsOpen]);

  useLayoutEffect(() => {
    if (!settingsOpen || !settingsRef.current) {
      setSettingsMenuPosition(null);
      return;
    }

    const updatePosition = () => {
      if (!settingsRef.current) {
        return;
      }

      const rect = settingsRef.current.getBoundingClientRect();
      setSettingsMenuPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [settingsOpen]);

  const settingsPanel = settingsOpen && settingsMenuPosition ? (
    <div
      ref={settingsPanelRef}
      className="fixed z-[200] w-56 rounded-lg border border-zinc-700 bg-zinc-950 p-3 shadow-2xl"
      style={{
        top: settingsMenuPosition.top,
        right: settingsMenuPosition.right,
        backgroundColor: '#09090b',
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Settings
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-zinc-400">Practice Mode</span>
          <div
            className="flex gap-1 rounded-md border border-zinc-700 bg-zinc-800 p-0.5"
            role="group"
            aria-label="Practice Mode"
          >
            <button
              type="button"
              onClick={() => setEngineMode('one-hand')}
              aria-pressed={engineMode === 'one-hand'}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                engineMode === 'one-hand'
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              One Hand
            </button>
            <button
              type="button"
              onClick={() => setEngineMode('two-hand')}
              aria-pressed={engineMode === 'two-hand'}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                engineMode === 'two-hand'
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Two Hands
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor="auto-fingering-toggle"
            className="text-xs text-zinc-400"
          >
            Auto-fingering
          </label>
          <input
            id="auto-fingering-toggle"
            type="checkbox"
            checked={autoFingering}
            onChange={(event) => setAutoFingering(event.target.checked)}
            className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-violet-600 focus:ring-violet-500 focus:ring-offset-zinc-950"
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs text-zinc-400">Hand Size</span>
          <div
            className="flex gap-1 rounded-md border border-zinc-700 bg-zinc-800 p-0.5"
            role="group"
            aria-label="Hand size"
          >
            <button
              type="button"
              onClick={() => setHandSpan(HAND_SPAN_PRESETS[0])}
              aria-pressed={handSpan === HAND_SPAN_PRESETS[0]}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${handSpanClass(HAND_SPAN_PRESETS[0])}`}
            >
              Small
            </button>
            <button
              type="button"
              onClick={() => setHandSpan(HAND_SPAN_PRESETS[1])}
              aria-pressed={handSpan === HAND_SPAN_PRESETS[1]}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${handSpanClass(HAND_SPAN_PRESETS[1])}`}
            >
              Medium
            </button>
            <button
              type="button"
              onClick={() => setHandSpan(HAND_SPAN_PRESETS[2])}
              aria-pressed={handSpan === HAND_SPAN_PRESETS[2]}
              className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${handSpanClass(HAND_SPAN_PRESETS[2])}`}
            >
              Large
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="sheet-scroll-mode-select"
            className="text-xs text-zinc-400"
          >
            Line Scroll
          </label>
          <select
            id="sheet-scroll-mode-select"
            value={sheetScrollMode}
            onChange={(event) =>
              setSheetScrollMode(event.target.value as SheetScrollMode)
            }
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          >
            <option value="smooth">Smooth scroll</option>
            <option value="instant">Instant jump</option>
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="shift-mode-select"
            className="text-xs text-zinc-400"
          >
            Scope Shift Mode
          </label>
          <select
            id="shift-mode-select"
            value={shiftMode}
            disabled={engineMode === 'two-hand'}
            onChange={(event) =>
              setShiftMode(event.target.value as ShiftMode)
            }
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="semitone">{SHIFT_MODE_LABELS.semitone}</option>
            <option value="octave">{SHIFT_MODE_LABELS.octave}</option>
            <option value="full-range">
              {SHIFT_MODE_LABELS['full-range']}
            </option>
          </select>
        </div>
      </div>
    </div>
  ) : null;

  const handleImportClick = () => {
    if (!canManageLibrary) {
      return;
    }

    fileInputRef.current?.click();
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file || !canManageLibrary) {
      return;
    }

    void (async () => {
      try {
        const text = await readMusicXmlFromFile(file);
        const script = parseMusicXmlToScript(text);
        const title = titleFromFileName(file.name);
        const loadedScript = prepareScriptForLoad(script);
        loadScript(loadedScript, text, title);

        if (userId) {
          const saved = await saveScoreToLibrary(title, text, userId);
          if (!saved.ok) {
            console.error('[scoreLibrary] Failed to save score:', saved.reason);
          }
        }

        console.log('🎉 PARSE SUCCESS! Final PlaybackScript:', loadedScript);
      } catch (error) {
        console.error('🚨 PARSE FAILED:', error);
        alert('Failed to load piece: ' + (error as Error).message);
      }
    })();

    event.target.value = '';
  };

  const handleSelectFromLibrary = async (id: string) => {
    if (!userId) {
      return;
    }

    const saved = await fetchScoreById(id, userId);
    if (!saved) {
      return;
    }

    try {
      const script = parseMusicXmlToScript(saved.raw_xml);
      loadScript(prepareScriptForLoad(script), saved.raw_xml, saved.title);
    } catch (error) {
      console.error('🚨 PARSE FAILED:', error);
      alert('Failed to load piece: ' + (error as Error).message);
    }
  };

  const handleHandChange = (hand: Hand) => {
    const state = useEngineStore.getState();
    if (state.engineMode === 'two-hand' || hand === state.activeHand) {
      return;
    }

    const wasPracticing = state.isPracticeActive;
    state.actions.setActiveHand(hand);
    practiceEngine.switchHand(wasPracticing);
  };

  const handToggleClass = (selected: boolean, disabled: boolean) =>
    disabled
      ? 'cursor-not-allowed text-zinc-600'
      : selected
        ? 'bg-violet-600 text-white'
        : 'text-zinc-400 hover:text-zinc-200';

  const headerToggleClass = (visible: boolean) =>
    visible
      ? 'inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100'
      : 'fixed left-8 top-4 z-50 inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700/70 bg-zinc-900/30 text-zinc-300/90 shadow-sm backdrop-blur-sm transition-colors hover:border-zinc-600 hover:bg-zinc-900/50 hover:text-zinc-100 sm:left-10 sm:top-[1.125rem]';

  const toggleCollapsed = () => {
    toggleHeaderCollapsed();
  };

  const playControls = (
    <>
      <button
        type="button"
        onClick={() => practiceEngine.start()}
        disabled={!script || isPracticeActive}
        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Play size={15} strokeWidth={2} aria-hidden />
        Start
      </button>
      {isPracticeActive ? (
        <button
          type="button"
          onClick={() => practiceEngine.pause()}
          className="inline-flex min-w-[6.25rem] items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <Pause size={15} strokeWidth={2} aria-hidden />
          Pause
        </button>
      ) : (
        <button
          type="button"
          onClick={() => practiceEngine.restart()}
          disabled={!script || !hasPracticeStarted}
          className="inline-flex min-w-[6.25rem] items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw size={15} strokeWidth={2} aria-hidden />
          Restart
        </button>
      )}
    </>
  );

  const handToggle = script && (engineMode === 'one-hand' || engineMode === 'two-hand') ? (
    <div
      className={`flex gap-1 rounded-lg border p-0.5 ${
        engineMode === 'two-hand'
          ? 'cursor-not-allowed border-zinc-800 bg-zinc-950 opacity-50'
          : 'border-zinc-700 bg-zinc-900'
      }`}
      role="group"
      aria-label="Active hand"
      aria-disabled={engineMode === 'two-hand'}
    >
      <button
        type="button"
        onClick={() => handleHandChange('L')}
        disabled={engineMode === 'two-hand'}
        aria-pressed={activeHand === 'L'}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${handToggleClass(activeHand === 'L', engineMode === 'two-hand')}`}
      >
        LH
      </button>
      <button
        type="button"
        onClick={() => handleHandChange('R')}
        disabled={engineMode === 'two-hand'}
        aria-pressed={activeHand === 'R'}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${handToggleClass(activeHand === 'R', engineMode === 'two-hand')}`}
      >
        RH
      </button>
    </div>
  ) : null;

  const collapseButton = (
    <button
      type="button"
      onClick={toggleCollapsed}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand header' : 'Collapse header'}
      title={collapsed ? 'Expand header' : 'Collapse header'}
      className={headerToggleClass(!collapsed)}
    >
      {collapsed ? (
        <ChevronDown size={12} strokeWidth={2.5} aria-hidden />
      ) : (
        <ChevronUp size={12} strokeWidth={2.5} aria-hidden />
      )}
    </button>
  );

  if (collapsed) {
    return (
      <>
        <input
          type="file"
          accept=".xml,.musicxml,.mxl"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileUpload}
        />

        {collapseButton}

        <ScoreLibraryPanel
          isOpen={isLibraryOpen}
          onClose={() => setIsLibraryOpen(false)}
          onSelect={handleSelectFromLibrary}
          canDelete={canManageLibrary}
          userId={userId ?? null}
        />
      </>
    );
  }

  return (
    <header className="flex shrink-0 items-center justify-between gap-6 border-b border-zinc-800 bg-zinc-950/90 px-6 py-4 backdrop-blur-sm">
      <input
        type="file"
        accept=".xml,.musicxml,.mxl"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileUpload}
      />

      <div className="flex min-w-0 items-center gap-3">
        {collapseButton}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400">
          <Music2 size={18} strokeWidth={2} aria-hidden />
        </div>
        <div className="min-w-0 text-left">
          <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-100">
            PlayRight
          </h1>
          <p className="truncate text-xs text-zinc-500">
            Keyboard-Controlled Piano Practice
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-center px-4">
        <div className="flex w-full max-w-md items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
          <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-zinc-600">
            Piece
          </span>
          <span className="truncate text-sm text-zinc-400">
            {songTitle ?? 'No Piece Loaded'}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setIsLibraryOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <Library size={15} strokeWidth={2} aria-hidden />
          Songs
        </button>
        <button
          type="button"
          onClick={handleImportClick}
          disabled={!canManageLibrary}
          title={canManageLibrary ? 'Import a MusicXML or MXL file' : 'Sign in to import songs'}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload size={15} strokeWidth={2} aria-hidden />
          Import
        </button>
        {playControls}

        {handToggle}

        <ShortcutsMenu
          isOpen={shortcutsOpen}
          onToggle={() => {
            setSettingsOpen(false);
            setShortcutsOpen((open) => !open);
          }}
          onClose={() => setShortcutsOpen(false)}
        />

        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            onClick={() => {
              setShortcutsOpen(false);
              setSettingsOpen((open) => !open);
            }}
            aria-expanded={settingsOpen}
            aria-haspopup="true"
            aria-label="Settings"
            className={`inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              settingsOpen
                ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100'
            }`}
          >
            <Settings size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <AccountSection />
      </div>
      {settingsPanel ? createPortal(settingsPanel, document.body) : null}
      <ScoreLibraryPanel
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onSelect={handleSelectFromLibrary}
        canDelete={canManageLibrary}
        userId={userId ?? null}
      />
    </header>
  );
}
