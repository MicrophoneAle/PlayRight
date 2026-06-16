import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Music2, Pause, Play, Settings, Upload } from 'lucide-react';
import { MusicXMLParser } from '../core/parser/index.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

export function Lid() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const songTitle = useEngineStore((state) => state.songTitle);
  const shiftMode = useEngineStore((state) => state.shiftMode);
  const loadScript = useEngineStore((state) => state.actions.loadScript);
  const toggleShiftMode = useEngineStore(
    (state) => state.actions.toggleShiftMode,
  );

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(event.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
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
        const script = MusicXMLParser.parse(text);
        loadScript(script, file.name.replace('.musicxml', ''));
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
            Keyboard-controlled piano practice
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
          onClick={handleImportClick}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <Upload size={15} strokeWidth={2} aria-hidden />
          Import
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
        >
          <Play size={15} strokeWidth={2} aria-hidden />
          Start
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <Pause size={15} strokeWidth={2} aria-hidden />
          Pause
        </button>

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
            <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                Settings
              </p>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-zinc-400">Scope shift mode</span>
                <button
                  type="button"
                  onClick={toggleShiftMode}
                  className="rounded-md bg-zinc-800 px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-700"
                >
                  {shiftMode === 'octave' ? 'Full Octave' : 'Single Note'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
