import { Lid } from './Lid.tsx';
import { PianoKeyboard } from './PianoKeyboard.tsx';
import { SheetMusicDisplay } from './SheetMusicDisplay.tsx';
import {
  countCompletedPracticeSteps,
  countPracticeSteps,
} from '../core/practiceSteps.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

function formatHandLabel(hand: 'L' | 'R'): string {
  return hand === 'L' ? 'Left hand' : 'Right hand';
}

export function Dashboard() {
  const script = useEngineStore((state) => state.script);
  const rawXml = useEngineStore((s) => s.rawXml);
  const currentStepIndex = useEngineStore((state) => state.currentStepIndex);
  const totalSteps = useEngineStore((state) => state.totalSteps);
  const engineMode = useEngineStore((state) => state.engineMode);
  const activeHand = useEngineStore((state) => state.activeHand);

  const practiceStepTotal =
    script && engineMode === 'one-hand'
      ? countPracticeSteps(script, engineMode, activeHand)
      : totalSteps;

  const practiceStepNumber =
    script && engineMode === 'one-hand'
      ? countCompletedPracticeSteps(script, engineMode, activeHand, currentStepIndex) + 1
      : currentStepIndex + 1;

  const isComplete = script ? currentStepIndex >= totalSteps : false;

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <Lid />
      <main className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-3">
        <SheetMusicDisplay musicXml={rawXml} />
        <div className="mt-2 text-center">
          {script ? (
            <p className="text-sm font-medium text-zinc-300">
              {isComplete
                ? `Piece complete${engineMode === 'one-hand' ? ` — ${formatHandLabel(activeHand)}` : ''}`
                : `Step ${practiceStepNumber} of ${practiceStepTotal}${
                    engineMode === 'one-hand' ? ` · ${formatHandLabel(activeHand)}` : ''
                  }`}
            </p>
          ) : (
            <p className="text-sm font-medium text-zinc-500">
              Import a MusicXML or MXL file to load a piece
            </p>
          )}
        </div>
      </main>
      <PianoKeyboard />
    </div>
  );
}
