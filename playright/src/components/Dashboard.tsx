import { Lid } from './Lid.tsx';
import { PianoKeyboard } from './PianoKeyboard.tsx';
import { useEngineStore } from '../store/useEngineStore.ts';

export function Dashboard() {
  const script = useEngineStore((state) => state.script);
  const shiftMode = useEngineStore((state) => state.shiftMode);
  const toggleShiftMode = useEngineStore(
    (state) => state.actions.toggleShiftMode,
  );
  const stepCount = script?.length ?? 0;

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <Lid />
      <main className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="text-center">
          {script ? (
            <p className="text-sm font-medium text-zinc-300">
              Piece loaded — {stepCount} step{stepCount === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="text-sm font-medium text-zinc-500">
              Import a MusicXML file to load a piece
            </p>
          )}
          <div className="mt-4 flex flex-col items-center gap-2">
            <span className="text-sm text-zinc-500">
              Use Arrow Keys to shift scope
            </span>
            <button
              type="button"
              onClick={toggleShiftMode}
              className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
            >
              Shift Mode:{' '}
              {shiftMode === 'octave' ? 'Full Octave' : 'Single Note'}
            </button>
          </div>
        </div>
      </main>
      <PianoKeyboard />
    </div>
  );
}
