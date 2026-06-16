import { Lid } from './Lid.tsx';
import { PianoKeyboard } from './PianoKeyboard.tsx';
import { useEngineStore } from '../store/useEngineStore.ts';

export function Dashboard() {
  const script = useEngineStore((state) => state.script);
  const stepCount = script?.length ?? 0;

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <Lid />
      <main className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="text-center">
          {script ? (
            <>
              <p className="text-sm font-medium text-zinc-300">
                Piece loaded — {stepCount} step{stepCount === 1 ? '' : 's'}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                Press Q through \ to trigger notes
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-zinc-500">
                Press Q through \ to trigger notes
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                Import a MusicXML file to load a piece
              </p>
            </>
          )}
        </div>
      </main>
      <PianoKeyboard />
    </div>
  );
}
