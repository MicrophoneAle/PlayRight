import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Library, Music2, Pause, Play, Settings, Upload } from 'lucide-react';
import { parseMusicXmlToScript } from '../core/parser/index.ts';
import { practiceEngine } from '../core/PracticeEngine.ts';
import { fetchScoreById, saveScoreToLibrary } from '../core/scoreLibrary.ts';
import { useEngineStore, type ShiftMode } from '../store/useEngineStore.ts';
import type { Hand } from '../types/index.ts';
import { ScoreLibraryPanel } from './ScoreLibraryPanel.tsx';

export function Lid() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const songTitle = useEngineStore((state) => state.songTitle);
  const script = useEngineStore((state) => state.script);
  const isPracticeActive = useEngineStore((state) => state.isPracticeActive);
  const shiftMode = useEngineStore((state) => state.shiftMode);
  const engineMode = useEngineStore((state) => state.engineMode);
  const activeHand = useEngineStore((state) => state.activeHand);
  const loadScript = useEngineStore((state) => state.actions.loadScript);
  const setShiftMode = useEngineStore((state) => state.actions.setShiftMode);
  const setEngineMode = useEngineStore((state) => state.actions.setEngineMode);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(event.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('click', handleOutsideClick);

    return () => {
      window.removeEventListener('click', handleOutsideClick);
    };
  }, [settingsOpen]);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const text = reader.result;

      if (typeof text !== 'string') {
        alert('[PlayRight] Failed to read file: unexpected result type.');
        return;
      }

      try {
        const script = parseMusicXmlToScript(text);
        const title = file.name.replace('.musicxml', '');
        loadScript(script, text, title);
        saveScoreToLibrary(title, text).catch((err) =>
          console.error('[scoreLibrary] Unexpected save error:', err),
        );
        console.log('🎉 PARSE SUCCESS! Final PlaybackScript:', script);
      } catch (error) {
        console.error('🚨 PARSE FAILED:', error);
        alert('Failed to load piece: ' + (error as Error).message);
      }
    };

    reader.onerror = () => {
      console.error('[PlayRight] FileReader error:', reader.error);
      alert('[PlayRight] Failed to read the selected file.');
    };

    reader.readAsText(file);
    event.target.value = '';
  };

  const handleSelectFromLibrary = async (id: string) => {
    const saved = await fetchScoreById(id);
    if (!saved) {
      return;
    }

    try {
      const script = parseMusicXmlToScript(saved.raw_xml);
      loadScript(script, saved.raw_xml, saved.title);
    } catch (error) {
      console.error('🚨 PARSE FAILED:', error);
      alert('Failed to load piece: ' + (error as Error).message);
    }
  };

  const handleHandChange = (hand: Hand) => {
    const state = useEngineStore.getState();
    if (hand === state.activeHand) {
      return;
    }

    const wasPracticing = state.isPracticeActive;
    state.actions.setActiveHand(hand);
    practiceEngine.switchHand(wasPracticing);
  };

  const handToggleClass = (selected: boolean) =>
    selected
      ? 'bg-violet-600 text-white'
      : 'text-zinc-400 hover:text-zinc-200';

  return (
    <header className="flex shrink-0 items-center justify-between gap-6 border-b border-zinc-800 bg-zinc-950/90 px-6 py-4 backdrop-blur-sm">
      <input
        type="file"
        accept=".xml,.musicxml"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileUpload}
      />

      <div className="flex min-w-0 items-center gap-3">
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
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <Upload size={15} strokeWidth={2} aria-hidden />
          Import
        </button>
        <button
          type="button"
          onClick={() => practiceEngine.start()}
          disabled={!script || isPracticeActive}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={15} strokeWidth={2} aria-hidden />
          Start
        </button>
        <button
          type="button"
          onClick={() => practiceEngine.pause()}
          disabled={!isPracticeActive}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Pause size={15} strokeWidth={2} aria-hidden />
          Pause
        </button>

        {script && engineMode === 'one-hand' ? (
          <div
            className="flex gap-1 rounded-lg border border-zinc-700 bg-zinc-900 p-0.5"
            role="group"
            aria-label="Active hand"
          >
            <button
              type="button"
              onClick={() => handleHandChange('L')}
              aria-pressed={activeHand === 'L'}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${handToggleClass(activeHand === 'L')}`}
            >
              LH
            </button>
            <button
              type="button"
              onClick={() => handleHandChange('R')}
              aria-pressed={activeHand === 'R'}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${handToggleClass(activeHand === 'R')}`}
            >
              RH
            </button>
          </div>
        ) : null}

        <div className="relative" ref={settingsRef}>
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
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

          {settingsOpen ? (
            <div
              className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Settings
              </p>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-zinc-400">Practice mode</span>
                  <div
                    className="flex gap-1 rounded-md border border-zinc-700 bg-zinc-800/50 p-0.5"
                    role="group"
                    aria-label="Practice mode"
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
                      One hand
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Coming soon"
                      className="flex-1 cursor-not-allowed rounded px-2 py-1.5 text-xs font-medium text-zinc-600"
                    >
                      Two hand
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="shift-mode-select"
                    className="text-xs text-zinc-400"
                  >
                    Scope shift mode
                  </label>
                  <select
                    id="shift-mode-select"
                    value={shiftMode}
                    onChange={(event) =>
                      setShiftMode(event.target.value as ShiftMode)
                    }
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  >
                    <option value="octave">Octave</option>
                    <option value="semitone">Single Note</option>
                    <option value="full-range">Full Range</option>
                  </select>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <ScoreLibraryPanel
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        onSelect={handleSelectFromLibrary}
      />
    </header>
  );
}
