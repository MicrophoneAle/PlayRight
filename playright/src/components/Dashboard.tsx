import { Lid } from './Lid.tsx';
import { PianoKeyboard } from './PianoKeyboard.tsx';
import { SheetMusicDisplay } from './SheetMusicDisplay.tsx';
import { useEngineStore } from '../store/useEngineStore.ts';

export function Dashboard() {
  const script = useEngineStore((state) => state.script);
  const rawXml = useEngineStore((s) => s.rawXml);
  const currentStepIndex = useEngineStore((state) => state.currentStepIndex);
  const totalSteps = useEngineStore((state) => state.totalSteps);

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <Lid />
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-3">
        <SheetMusicDisplay musicXml={rawXml} />
        <div className="mt-2 text-center">
          {script ? (
            <p className="text-sm font-medium text-zinc-300">
              {currentStepIndex >= totalSteps
                ? 'Piece complete'
                : `Step ${currentStepIndex + 1} of ${totalSteps}`}
            </p>
          ) : (
            <p className="text-sm font-medium text-zinc-500">
              Import a MusicXML file to load a piece
            </p>
          )}
          <p className="mt-1 text-sm text-zinc-500">
            Use Arrow Keys or 1 / 2 to shift scope
          </p>
        </div>
      </main>
      <PianoKeyboard />
    </div>
  );
}
