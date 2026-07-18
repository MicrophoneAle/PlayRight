import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@clerk/react';
import { Library, Music2, Pause, Play, RotateCcw, Settings, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { parseMusicXmlToScript } from '../core/parser/index.ts';
import { prepareScriptWithFingering } from '../core/fingeringPredictor.ts';
import { migrateLegacyHandOverridesOnLoad } from '../core/manualHandOverrideMigration.ts';
import { practiceEngine } from '../core/PracticeEngine.ts';
import { playbackEngine } from '../core/PlaybackEngine.ts';
import { readMusicXmlFromFile, titleFromFileName } from '../core/readScoreFile.ts';
import { fetchScoreById, fetchScoreLibrary, saveScoreToLibrary, updateScoreManualFingerings } from '../core/scoreLibrary.ts';
import { isSupabaseConfigured } from '../core/supabaseClient.ts';
import { useEngineStore, surfaceMlFingeringFallbackWarning, type HandSpanPreset, type ShiftMode, type SheetScrollMode, HAND_SPAN_PRESETS, TEMPO_FACTOR_MIN, TEMPO_FACTOR_MAX, TEMPO_FACTOR_STEP } from '../store/useEngineStore.ts';
import type { FingeringMode, Hand, ManualFingeringMap, PlaybackScript, ScoreTiming } from '../types/index.ts';
import { computeAnchorDropdownPosition, SETTINGS_PANEL_WIDTH } from '../core/anchorDropdownPosition.ts';
import { SHIFT_MODE_LABELS } from '../core/shiftMode.ts';
import { ParseWarningsPanel } from './ParseWarningsPanel.tsx';
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
    maxHeight: number;
  } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const isLibraryOpen = useEngineStore((state) => state.scoreLibraryOpen);
  const setScoreLibraryOpen = useEngineStore((state) => state.actions.setScoreLibraryOpen);
  const collapsed = useEngineStore((state) => state.headerCollapsed);
  const toggleHeaderCollapsed = useEngineStore(
    (state) => state.actions.toggleHeaderCollapsed,
  );
  const { isLoaded: isAuthLoaded, isSignedIn, userId } = useAuth();
  const songTitle = useEngineStore((state) => state.songTitle);
  const script = useEngineStore((state) => state.script);
  const isPracticeActive = useEngineStore((state) => state.isPracticeActive);
  const hasPracticeStarted = useEngineStore((state) => state.hasPracticeStarted);
  const playMode = useEngineStore((state) => state.playMode);
  const playModeFingeringsVisible = useEngineStore(
    (state) => state.playModeFingeringsVisible,
  );
  const tempoFactor = useEngineStore((state) => state.tempoFactor);
  const isPlaybackActive = useEngineStore((state) => state.isPlaybackActive);
  const isPlaybackFinished = useEngineStore((state) => state.isPlaybackFinished);
  const isPlaybackPaused = useEngineStore((state) => state.isPlaybackPaused);
  const shiftMode = useEngineStore((state) => state.shiftMode);
  const sheetScrollMode = useEngineStore((state) => state.sheetScrollMode);
  const autoFingering = useEngineStore((state) => state.autoFingering);
  const overrideScoreFingerings = useEngineStore((state) => state.overrideScoreFingerings);
  const handSpan = useEngineStore((state) => state.handSpan);
  const engineMode = useEngineStore((state) => state.engineMode);
  const activeHand = useEngineStore((state) => state.activeHand);
  const loadScript = useEngineStore((state) => state.actions.loadScript);
  const setParseWarnings = useEngineStore((state) => state.actions.setParseWarnings);
  const setShiftMode = useEngineStore((state) => state.actions.setShiftMode);
  const setSheetScrollMode = useEngineStore((state) => state.actions.setSheetScrollMode);
  const setAutoFingering = useEngineStore((state) => state.actions.setAutoFingering);
  const setOverrideScoreFingerings = useEngineStore(
    (state) => state.actions.setOverrideScoreFingerings,
  );
  const setHandSpan = useEngineStore((state) => state.actions.setHandSpan);
  const setEngineMode = useEngineStore((state) => state.actions.setEngineMode);
  const setPlayMode = useEngineStore((state) => state.actions.setPlayMode);
  const setPlayModeFingeringsVisible = useEngineStore(
    (state) => state.actions.setPlayModeFingeringsVisible,
  );
  const setTempoFactor = useEngineStore((state) => state.actions.setTempoFactor);

  const setFingeringMode = useEngineStore((state) => state.actions.setFingeringMode);
  const fingeringMode = useEngineStore((state) => state.fingeringMode);
  const currentStepIndex = useEngineStore((state) => state.currentStepIndex);
  const totalSteps = useEngineStore((state) => state.totalSteps);

  const prepareScriptForLoad = async (
    script: PlaybackScript,
    manualFingerings: ManualFingeringMap = {},
    scoreId: string | null = null,
    scoreTiming?: ScoreTiming | null,
    userIdForMigration?: string | null,
  ) => {
    const { manualFingerings: migratedFingerings, didMigrate } =
      migrateLegacyHandOverridesOnLoad(script, manualFingerings, scoreId);

    if (didMigrate && scoreId && userIdForMigration) {
      void updateScoreManualFingerings(scoreId, userIdForMigration, migratedFingerings);
    }

    const state = useEngineStore.getState();
    const prepared = await prepareScriptWithFingering(
      script,
      migratedFingerings,
      state.autoFingering,
      state.handSpan,
      state.overrideScoreFingerings,
      scoreTiming,
    );
    surfaceMlFingeringFallbackWarning(state.autoFingering);

    return { script: prepared, manualFingerings: migratedFingerings };
  };

  const handSpanClass = (preset: HandSpanPreset) =>
    handSpan === preset
      ? 'bg-violet-600 text-white'
      : 'text-zinc-400 hover:text-zinc-200';

  const canManageLibrary = isAuthLoaded && isSignedIn && Boolean(userId);

  useEffect(() => {
    if (userId && isSupabaseConfigured()) {
      void fetchScoreLibrary(userId);
    }
  }, [userId]);

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
      setSettingsMenuPosition(
        computeAnchorDropdownPosition(rect, {
          panelWidth: SETTINGS_PANEL_WIDTH,
        }),
      );
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [settingsOpen]);

  const settingsCheckboxClass =
    'h-4 w-4 shrink-0 rounded border-zinc-600 bg-zinc-900 text-violet-600 focus:ring-violet-500 focus:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-40';
  const settingsRowClass = 'flex items-center justify-between gap-2';
  const settingsLabelClass = 'min-w-0 truncate text-xs text-zinc-400';

  const headerActionClass =
    'inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 sm:px-3.5';

  const settingsPanel = settingsOpen && settingsMenuPosition ? (
    <div
      ref={settingsPanelRef}
      className="fixed z-[200] flex w-[min(18rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
      style={{
        top: settingsMenuPosition.top,
        right: settingsMenuPosition.right,
        maxHeight: settingsMenuPosition.maxHeight,
        backgroundColor: '#09090b',
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className="mb-2 shrink-0 px-3 pt-3 text-xs font-medium uppercase tracking-wider text-zinc-500">
        Settings
      </p>
      <div className="playright-popup-scroll playright-scrollbar flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
        <div className={settingsRowClass}>
          <label
            htmlFor="play-mode-toggle"
            className={settingsLabelClass}
            title="Play mode"
          >
            Play mode
          </label>
          <input
            id="play-mode-toggle"
            type="checkbox"
            checked={playMode}
            onChange={(event) => setPlayMode(event.target.checked)}
            disabled={fingeringMode !== 'off'}
            className={settingsCheckboxClass}
          />
        </div>
        <div className={settingsRowClass}>
          <label
            htmlFor="play-fingerings-toggle"
            className={`${settingsLabelClass}${playMode ? '' : ' opacity-40'}`}
            title="Show two-hand fingerings"
          >
            Show two-hand fingerings
          </label>
          <input
            id="play-fingerings-toggle"
            type="checkbox"
            checked={playModeFingeringsVisible}
            disabled={!playMode}
            onChange={(event) =>
              setPlayModeFingeringsVisible(event.target.checked)
            }
            className={settingsCheckboxClass}
          />
        </div>
        <div className="flex flex-col gap-2">
          <label
            htmlFor="tempo-factor-slider"
            className="text-xs text-zinc-400"
          >
            Playback tempo: {tempoFactor.toFixed(2)}x
          </label>
          <input
            id="tempo-factor-slider"
            type="range"
            min={TEMPO_FACTOR_MIN}
            max={TEMPO_FACTOR_MAX}
            step={TEMPO_FACTOR_STEP}
            value={tempoFactor}
            onChange={(event) => setTempoFactor(Number(event.target.value))}
            className="w-full accent-violet-600"
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-xs text-zinc-400">Fingering mode</span>
          <div
            className="flex gap-1 rounded-md border border-zinc-700 bg-zinc-800 p-0.5"
            role="group"
            aria-label="Fingering mode"
          >
            {(['off', 'program'] as FingeringMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={
                  playMode ||
                  (mode === 'program' && engineMode !== 'two-hand')
                }
                onClick={() => setFingeringMode(mode)}
                aria-pressed={fingeringMode === mode}
                className={`flex-1 rounded px-2 py-1.5 text-xs font-medium capitalize transition-colors disabled:opacity-40 ${
                  fingeringMode === mode
                    ? 'bg-violet-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          {engineMode !== 'two-hand' ? (
            <p className="text-[10px] leading-snug text-zinc-500">
              Program mode requires Two Hand practice.
            </p>
          ) : null}
          {fingeringMode === 'program' ? (
            <p className="text-[10px] leading-snug text-zinc-500">
              Step {currentStepIndex + 1} / {totalSteps}. Press finger keys low→high per hand for
              every note in the step before advancing.
            </p>
          ) : null}
        </div>
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
              disabled={fingeringMode === 'program'}
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
        <div className={settingsRowClass}>
          <label
            htmlFor="auto-fingering-toggle"
            className={settingsLabelClass}
            title="Auto-fingering"
          >
            Auto-fingering
          </label>
          <input
            id="auto-fingering-toggle"
            type="checkbox"
            checked={autoFingering}
            onChange={(event) => setAutoFingering(event.target.checked)}
            className={settingsCheckboxClass}
          />
        </div>
        <div className={settingsRowClass}>
          <label
            htmlFor="override-score-fingerings-toggle"
            className={settingsLabelClass}
            title="Override score fingerings"
          >
            Override score fingerings
          </label>
          <input
            id="override-score-fingerings-toggle"
            type="checkbox"
            checked={overrideScoreFingerings}
            onChange={(event) => setOverrideScoreFingerings(event.target.checked)}
            className={settingsCheckboxClass}
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
            disabled={engineMode === 'two-hand' || playMode}
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
        const { script, scoreTiming, playbackOrder, warnings } = parseMusicXmlToScript(text);
        const title = titleFromFileName(file.name);
        const { script: loadedScript, manualFingerings } = await prepareScriptForLoad(
          script,
          {},
          null,
          scoreTiming,
        );
        let scoreId: string | null = null;

        if (userId) {
          const saved = await saveScoreToLibrary(title, text, userId);
          if (!saved.ok) {
            console.error('[scoreLibrary] Failed to save score:', saved.reason);
          } else {
            scoreId = saved.id;
            void fetchScoreLibrary(userId, { force: true });
          }
        }

        loadScript(loadedScript, text, title, {
          scoreId,
          manualFingerings,
        }, scoreTiming, playbackOrder);
        setParseWarnings(warnings);

        console.log('🎉 PARSE SUCCESS! Final PlaybackScript:', loadedScript);
      } catch (error) {
        console.error('🚨 PARSE FAILED:', error);
        setParseWarnings(['Failed to load piece: ' + (error as Error).message]);
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
      const { script, scoreTiming, playbackOrder, warnings } = parseMusicXmlToScript(saved.raw_xml);
      const { script: loadedScript, manualFingerings } = await prepareScriptForLoad(
        script,
        saved.manual_fingerings,
        saved.id,
        scoreTiming,
        userId,
      );
      loadScript(loadedScript, saved.raw_xml, saved.title, {
        scoreId: saved.id,
        manualFingerings,
      }, scoreTiming, playbackOrder);
      setParseWarnings(warnings);
    } catch (error) {
      console.error('🚨 PARSE FAILED:', error);
      setParseWarnings(['Failed to load piece: ' + (error as Error).message]);
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

  const headerToggleClass =
    'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 active:translate-y-0 active:scale-100';

  const logoRowClass =
    'flex min-w-0 items-center gap-1.5 pl-8 sm:pl-10 lg:pl-12';

  const logoBrand = (
    <>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600/20 text-violet-400">
        <Music2 size={18} strokeWidth={2} aria-hidden />
      </div>
      <div className="min-w-0 text-left">
        <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-100">
          PlayRight
        </h1>
        <div className="hidden text-xs leading-tight text-zinc-500 xl:block">
          <span className="block">Keyboard-Controlled</span>
          <span className="block">Piano Practice</span>
        </div>
      </div>
    </>
  );

  const expandedHeaderRef = useRef<HTMLElement>(null);
  const collapseButtonRef = useRef<HTMLButtonElement>(null);
  const [lockedTogglePosition, setLockedTogglePosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const captureTogglePosition = useCallback(() => {
    const button = collapseButtonRef.current;
    if (!button) {
      return;
    }

    const { top, left } = button.getBoundingClientRect();
    setLockedTogglePosition((current) =>
      current?.top === top && current.left === left ? current : { top, left },
    );
  }, []);

  const toggleCollapsed = () => {
    if (!collapsed) {
      captureTogglePosition();
    }
    toggleHeaderCollapsed();
  };

  useLayoutEffect(() => {
    if (collapsed) {
      return;
    }

    captureTogglePosition();

    const header = expandedHeaderRef.current;
    if (!header) {
      return;
    }

    const observer = new ResizeObserver(() => {
      captureTogglePosition();
    });
    observer.observe(header);
    window.addEventListener('resize', captureTogglePosition);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', captureTogglePosition);
    };
  }, [collapsed, captureTogglePosition]);

  const renderCollapseButton = (
    buttonRef?: RefObject<HTMLButtonElement | null>,
    floating = false,
  ) => (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggleCollapsed}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand header' : 'Collapse header'}
      title={collapsed ? 'Expand header' : 'Collapse header'}
      className={
        headerToggleClass +
        (floating ? ' shadow-md ring-1 ring-zinc-700/80' : '')
      }
    >
      {collapsed ? (
        <ChevronDown size={10} strokeWidth={2.5} aria-hidden />
      ) : (
        <ChevronUp size={10} strokeWidth={2.5} aria-hidden />
      )}
    </button>
  );

  const playbackRunning = isPlaybackActive && !isPlaybackPaused;

  const playControls = playMode ? (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <button
        type="button"
        onClick={() => {
          if (playbackRunning) {
            playbackEngine.pause();
            return;
          }

          if (isPlaybackPaused) {
            playbackEngine.resume();
            return;
          }

          void playbackEngine.play();
        }}
        disabled={!script}
        aria-label={
          playbackRunning ? 'Pause playback' : isPlaybackFinished ? 'Replay' : 'Play'
        }
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-2.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3.5"
      >
        {playbackRunning ? (
          <>
            <Pause size={15} strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">Pause</span>
          </>
        ) : isPlaybackFinished ? (
          <>
            <RotateCcw size={15} strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">Replay</span>
          </>
        ) : (
          <>
            <Play size={15} strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">Play</span>
          </>
        )}
      </button>
      {playbackRunning ? null : (
        <button
          type="button"
          onClick={() => void playbackEngine.restart()}
          disabled={!script || !isPlaybackActive}
          aria-label="Restart playback"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[6.25rem] sm:px-3.5"
        >
          <RotateCcw size={15} strokeWidth={2} aria-hidden />
          <span className="hidden sm:inline">Restart</span>
        </button>
      )}
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <button
        type="button"
        onClick={() => practiceEngine.start()}
        disabled={!script || isPracticeActive || fingeringMode === 'program'}
        aria-label="Start practice"
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-2.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50 sm:px-3.5"
      >
        <Play size={15} strokeWidth={2} aria-hidden />
        <span className="hidden sm:inline">Start</span>
      </button>
      {isPracticeActive ? (
        <button
          type="button"
          onClick={() => practiceEngine.pause()}
          disabled={fingeringMode === 'program'}
          aria-label="Pause practice"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[6.25rem] sm:px-3.5"
        >
          <Pause size={15} strokeWidth={2} aria-hidden />
          <span className="hidden sm:inline">Pause</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => practiceEngine.restart()}
          disabled={!script || !hasPracticeStarted || fingeringMode === 'program'}
          aria-label="Restart practice"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-[6.25rem] sm:px-3.5"
        >
          <RotateCcw size={15} strokeWidth={2} aria-hidden />
          <span className="hidden sm:inline">Restart</span>
        </button>
      )}
    </div>
  );

  const handToggle = script && (engineMode === 'one-hand' || engineMode === 'two-hand') ? (
    <div
      className={`flex gap-1 rounded-lg border p-0.5 ${
        engineMode === 'two-hand' || playMode
          ? 'cursor-not-allowed border-zinc-800 bg-zinc-950 opacity-50'
          : 'border-zinc-700 bg-zinc-900'
      }`}
      role="group"
      aria-label="Active hand"
      aria-disabled={engineMode === 'two-hand' || playMode}
    >
      <button
        type="button"
        onClick={() => handleHandChange('L')}
        disabled={engineMode === 'two-hand' || playMode}
        aria-pressed={activeHand === 'L'}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${handToggleClass(activeHand === 'L', engineMode === 'two-hand' || playMode)}`}
      >
        LH
      </button>
      <button
        type="button"
        onClick={() => handleHandChange('R')}
        disabled={engineMode === 'two-hand' || playMode}
        aria-pressed={activeHand === 'R'}
        className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${handToggleClass(activeHand === 'R', engineMode === 'two-hand' || playMode)}`}
      >
        RH
      </button>
    </div>
  ) : null;

  const collapsedToggleOverlay =
    lockedTogglePosition === null ? null : (
      <div
        className="pointer-events-none fixed z-50"
        style={{
          top: `${lockedTogglePosition.top}px`,
          left: `${lockedTogglePosition.left}px`,
        }}
      >
        <div className="pointer-events-auto">
          {renderCollapseButton(undefined, true)}
        </div>
      </div>
    );

  const expandedHeader = (
    <header
      ref={expandedHeaderRef}
      className="flex shrink-0 flex-col gap-3 border-b border-zinc-800 bg-zinc-950/90 px-3 py-3 backdrop-blur-sm sm:px-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:px-6 lg:py-4"
    >
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4 lg:min-w-0 lg:flex-1 lg:gap-4">
        <div className={logoRowClass}>
          {renderCollapseButton(collapseButtonRef)}
          {logoBrand}
        </div>

        <div className="flex min-w-0 flex-1 items-center sm:max-w-xs lg:max-w-[14rem] xl:max-w-xs 2xl:max-w-sm">
          <div className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-2 sm:px-4 sm:py-2.5">
            <span className="hidden shrink-0 text-xs font-medium uppercase tracking-wider text-zinc-600 sm:inline">
              Piece
            </span>
            <span className="truncate text-sm text-zinc-400">
              {songTitle ?? 'No Piece Loaded'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={() => setScoreLibraryOpen(true)}
          className={headerActionClass}
        >
          <Library size={15} strokeWidth={2} aria-hidden />
          <span className="hidden sm:inline">Scores</span>
        </button>
        <button
          type="button"
          onClick={handleImportClick}
          disabled={!canManageLibrary}
          title={canManageLibrary ? 'Import a MusicXML or MXL file' : 'Sign in to import songs'}
          className={`${headerActionClass} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <Upload size={15} strokeWidth={2} aria-hidden />
          <span className="hidden sm:inline">Import</span>
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
            className={`${headerActionClass} ${
              settingsOpen
                ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                : ''
            }`}
          >
            <Settings size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <AccountSection />
      </div>
    </header>
  );

  return (
    <>
      <input
        type="file"
        accept=".xml,.musicxml,.mxl"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileUpload}
      />

      <ParseWarningsPanel />

      {collapsed ? collapsedToggleOverlay : expandedHeader}
      {settingsPanel ? createPortal(settingsPanel, document.body) : null}
      <ScoreLibraryPanel
        isOpen={isLibraryOpen}
        onClose={() => setScoreLibraryOpen(false)}
        onSelect={handleSelectFromLibrary}
        canDelete={canManageLibrary}
        userId={userId ?? null}
      />
    </>
  );
}
