import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  formatKeyCode,
  getDynamicKeyMap,
  SCOPE_SIZE,
} from '../core/InputManager.ts';
import { useEngineStore, type ShiftMode } from '../store/useEngineStore.ts';

const START_MIDI = 21;
const END_MIDI = 108;
const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

function getShiftAmount(mode: ShiftMode): number {
  switch (mode) {
    case 'octave':
      return 12;
    case 'semitone':
      return 1;
    case 'full-range':
      return SCOPE_SIZE;
  }
}

function shiftScope(
  direction: 'up' | 'down',
  setScopeStart: (midi: number | ((prev: number) => number)) => void,
): void {
  const shiftAmount = getShiftAmount(useEngineStore.getState().shiftMode);
  if (direction === 'up') {
    setScopeStart((prev) =>
      Math.min(prev + shiftAmount, END_MIDI - (SCOPE_SIZE - 1)),
    );
  } else {
    setScopeStart((prev) => Math.max(prev - shiftAmount, START_MIDI));
  }
}

interface KeyLayout {
  midi: number;
  offsetIndex: number;
}

function isInScope(midi: number, scopeStartMidi: number): boolean {
  return midi >= scopeStartMidi && midi <= scopeStartMidi + SCOPE_SIZE - 1;
}

function isMidiActive(
  midi: number,
  keyMap: Record<string, number>,
  activePhysicalKeys: ReadonlySet<string>,
): boolean {
  return Object.entries(keyMap).some(
    ([code, mappedMidi]) => mappedMidi === midi && activePhysicalKeys.has(code),
  );
}

function getWhiteKeyClasses(
  inScope: boolean,
  isExpected: boolean,
  isActive: boolean,
): string {
  const base =
    'relative z-0 flex-1 border-r border-zinc-300 transition-[transform,box-shadow,background-color] duration-75 first:rounded-bl-md last:rounded-br-md last:border-r-0';

  if (isActive && isExpected) {
    return `${base} translate-y-[3px] bg-emerald-300 shadow-[inset_0_3px_6px_rgba(5,150,105,0.45)] ring-2 ring-inset ring-emerald-500`;
  }
  if (isActive) {
    return `${base} translate-y-[3px] bg-zinc-300 shadow-inner`;
  }
  if (isExpected) {
    return `${base} bg-emerald-100 ring-2 ring-inset ring-emerald-400`;
  }
  if (inScope) {
    return `${base} bg-violet-100`;
  }
  return `${base} bg-white`;
}

function getBlackKeyClasses(
  inScope: boolean,
  isExpected: boolean,
  isActive: boolean,
): string {
  const base =
    'absolute z-10 rounded-b-sm shadow-md transition-[transform,box-shadow,background-color] duration-75';

  if (isActive && isExpected) {
    return `${base} translate-y-[2px] bg-emerald-950 shadow-[inset_0_4px_8px_rgba(6,78,59,0.8)] ring-2 ring-inset ring-emerald-400`;
  }
  if (isActive) {
    return `${base} translate-y-[2px] bg-zinc-600 shadow-inner`;
  }
  if (isExpected) {
    return `${base} bg-emerald-800 ring-2 ring-inset ring-emerald-400`;
  }
  if (inScope) {
    return `${base} bg-violet-900`;
  }
  return `${base} bg-zinc-900`;
}

export function PianoKeyboard() {
  const scopeStartMidi = useEngineStore((state) => state.scopeStartMidi);
  const expectedMidiNotes = useEngineStore((state) => state.expectedMidiNotes);
  const isPracticeActive = useEngineStore((state) => state.isPracticeActive);
  const setScopeStart = useEngineStore((state) => state.actions.setScopeStart);
  const [activePhysicalKeys, setActivePhysicalKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const keyMap = useMemo(
    () => getDynamicKeyMap(scopeStartMidi),
    [scopeStartMidi],
  );

  const expectedMidiSet = useMemo(
    () => new Set(expectedMidiNotes),
    [expectedMidiNotes],
  );

  const midiToPhysical = useMemo(() => {
    const currentMap = getDynamicKeyMap(scopeStartMidi);
    return Object.entries(currentMap).reduce<Record<number, string>>(
      (acc, [code, midi]) => {
        acc[midi] = formatKeyCode(code);
        return acc;
      },
      {},
    );
  }, [scopeStartMidi]);

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
      if (event.key === 'ArrowRight' || event.code === 'Digit2') {
        event.preventDefault();
        shiftScope('up', setScopeStart);
        return;
      }

      if (event.key === 'ArrowLeft' || event.code === 'Digit1') {
        event.preventDefault();
        shiftScope('down', setScopeStart);
        return;
      }

      if (event.key === 'ArrowUp' || event.code === 'Digit3') {
        event.preventDefault();
        useEngineStore.getState().actions.cycleShiftMode('up');
        return;
      }

      const midi = keyMap[event.code];
      if (midi === undefined) {
        return;
      }

      flushSync(() => {
        setActivePhysicalKeys((previous) => {
          if (previous.has(event.code)) {
            return previous;
          }

          const next = new Set(previous);
          next.add(event.code);
          return next;
        });
      });
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      flushSync(() => {
        setActivePhysicalKeys((previous) => {
          if (!previous.has(event.code)) {
            return previous;
          }

          const next = new Set(previous);
          next.delete(event.code);
          return next;
        });
      });
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    window.addEventListener('keyup', handleKeyUp, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      window.removeEventListener('keyup', handleKeyUp, { capture: true });
    };
  }, [setScopeStart, keyMap]);

  return (
    <div
      className="relative flex h-40 w-full select-none overflow-hidden rounded-b-md border-t border-zinc-800 shadow-2xl"
      aria-label="88-key piano keyboard"
    >
      {whiteKeys.map((key) => {
        const inScope = isInScope(key.midi, scopeStartMidi);
        const isActive = isMidiActive(key.midi, keyMap, activePhysicalKeys);
        const isExpected =
          isPracticeActive && expectedMidiSet.has(key.midi);
        const mappedLetter = midiToPhysical[key.midi];

        return (
          <div
            key={key.midi}
            className={getWhiteKeyClasses(inScope, isExpected, isActive)}
          >
            {mappedLetter && inScope ? (
              <span className="absolute bottom-2 w-full text-center text-xs font-bold text-zinc-800">
                {mappedLetter}
              </span>
            ) : null}
          </div>
        );
      })}
      {blackKeys.map((key) => {
        const inScope = isInScope(key.midi, scopeStartMidi);
        const isActive = isMidiActive(key.midi, keyMap, activePhysicalKeys);
        const isExpected =
          isPracticeActive && expectedMidiSet.has(key.midi);
        const mappedLetter = midiToPhysical[key.midi];

        return (
          <div
            key={key.midi}
            className={getBlackKeyClasses(inScope, isExpected, isActive)}
            style={{
              left: `calc(${(key.offsetIndex / 52) * 100}%)`,
              transform: 'translateX(-50%)',
              width: 'calc(100% / 52 * 0.65)',
              height: '65%',
            }}
          >
            {mappedLetter && inScope ? (
              <span className="absolute bottom-2 w-full text-center text-xs font-bold text-zinc-200">
                {mappedLetter}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
