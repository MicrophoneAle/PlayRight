import { Lid } from './Lid.tsx';
import { PianoKeyboard } from './PianoKeyboard.tsx';
import { SheetMusicDisplay } from './SheetMusicDisplay.tsx';
import { useEngineStore } from '../store/useEngineStore.ts';

export function Dashboard() {
  const script = useEngineStore((state) => state.script);
  const rawXml = useEngineStore((s) => s.rawXml);
  const stepCount = script?.length ?? 0;

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <Lid />
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-3">
        <SheetMusicDisplay musicXml={rawXml} />
        <div className="mt-2 text-center">
          {script ? (
            <p className="text-sm font-medium text-zinc-300">
              Piece loaded — {stepCount} step{stepCount === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="text-sm font-medium text-zinc-500">
              Import a MusicXML file to load a piece
            </p>
          )}
          <p className="mt-1 text-sm text-zinc-500">
            Use Arrow Keys to shift scope
          </p>
        </div>
      </main>
      <PianoKeyboard />
    </div>
  );
}
