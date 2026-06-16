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
      <main className="flex min-h-0 flex-1 flex-col px-6">
        <div className="min-h-0 w-full flex-1 overflow-auto">
          <SheetMusicDisplay musicXml={rawXml} />
        </div>
        <div className="shrink-0 text-center">
          {script ? (
            <p className="text-sm font-medium text-zinc-300">
              Piece loaded — {stepCount} step{stepCount === 1 ? '' : 's'}
            </p>
          ) : (
            <p className="text-sm font-medium text-zinc-500">
              Import a MusicXML file to load a piece
            </p>
          )}
          <p className="mt-2 text-sm text-zinc-500">
            Use Arrow Keys to shift scope
          </p>
        </div>
      </main>
      <PianoKeyboard />
    </div>
  );
}
