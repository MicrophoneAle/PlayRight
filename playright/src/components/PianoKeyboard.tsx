import { useEffect, useMemo } from 'react';
import { useEngineStore } from '../store/useEngineStore.ts';

const START_MIDI = 21;
const END_MIDI = 108;
const SCOPE_SIZE = 13;
const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

interface KeyLayout {
  midi: number;
  offsetIndex: number;
}

function isInScope(midi: number, scopeStartMidi: number): boolean {
  return midi >= scopeStartMidi && midi <= scopeStartMidi + SCOPE_SIZE - 1;
}

export function PianoKeyboard() {
  const scopeStartMidi = useEngineStore((state) => state.scopeStartMidi);
  const setScopeStart = useEngineStore((state) => state.actions.setScopeStart);

  const { whiteKeys, blackKeys } = useMemo(() => {
    const whiteKeys: KeyLayout[] = [];
    const blackKeys: KeyLayout[] = [];
    let whiteKeyCount = 0;

    for (let midi = START_MIDI; midi <= END_MIDI; midi += 1) {
      if (isBlackKey(midi)) {
        blackKeys.push({ midi, offsetIndex: whiteKeyCount });
      } else {
        whiteKeys.push({ midi, offsetIndex: whiteKeyCount });
        whiteKeyCount += 1;
      }
    }

    return { whiteKeys, blackKeys };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setScopeStart((prev) => Math.min(prev + 12, END_MIDI - (SCOPE_SIZE - 1)));
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setScopeStart((prev) => Math.max(prev - 12, START_MIDI));
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setScopeStart]);

  return (
    <div
      className="relative flex h-40 w-full select-none overflow-hidden rounded-b-md border-t border-zinc-800 shadow-2xl"
      aria-label="88-key piano keyboard"
    >
      {whiteKeys.map((key) => {
        const inScope = isInScope(key.midi, scopeStartMidi);

        return (
          <div
            key={key.midi}
            className={`relative z-0 flex-1 border-r border-zinc-300 transition-colors duration-75 first:rounded-bl-md last:rounded-br-md last:border-r-0 ${
              inScope
                ? 'bg-violet-100 hover:bg-violet-200'
                : 'bg-white hover:bg-zinc-100'
            }`}
          />
        );
      })}
      {blackKeys.map((key) => {
        const inScope = isInScope(key.midi, scopeStartMidi);

        return (
          <div
            key={key.midi}
            className={`absolute z-10 rounded-b-sm shadow-md transition-colors duration-75 ${
              inScope
                ? 'bg-violet-900 hover:bg-violet-800'
                : 'bg-zinc-900 hover:bg-zinc-700'
            }`}
            style={{
              left: `calc(${(key.offsetIndex / 52) * 100}%)`,
              transform: 'translateX(-50%)',
              width: 'calc(100% / 52 * 0.65)',
              height: '65%',
            }}
          />
        );
      })}
    </div>
  );
}
