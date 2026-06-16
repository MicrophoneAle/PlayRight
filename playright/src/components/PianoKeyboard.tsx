import { useEffect, useMemo, useState } from 'react';
import { useEngineStore } from '../store/useEngineStore.ts';

const START_MIDI = 21;
const END_MIDI = 108;
const SCOPE_SIZE = 13;
const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

interface KeyLayout {
  midi: number;
  offsetIndex: number;
}

function getDynamicKeyMap(scopeStart: number): Record<string, number> {
  const map: Record<string, number> = {};

  const whitePhysicals = [
    'KeyA',
    'KeyS',
    'KeyD',
    'KeyF',
    'KeyG',
    'KeyH',
    'KeyJ',
    'KeyK',
    'KeyL',
    'Semicolon',
    'Quote',
  ];

  const topLeftMap: Record<string, string> = {
    KeyA: 'KeyQ',
    KeyS: 'KeyW',
    KeyD: 'KeyE',
    KeyF: 'KeyR',
    KeyG: 'KeyT',
    KeyH: 'KeyY',
    KeyJ: 'KeyU',
    KeyK: 'KeyI',
    KeyL: 'KeyO',
    Semicolon: 'KeyP',
    Quote: 'BracketLeft',
  };

  const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);

  let whiteIndex = 0;
  for (let midi = scopeStart; midi <= scopeStart + 13; midi += 1) {
    if (!isBlack(midi)) {
      if (whiteIndex < whitePhysicals.length) {
        map[whitePhysicals[whiteIndex]] = midi;
      }
      whiteIndex += 1;
    }
  }

  for (let midi = scopeStart; midi <= scopeStart + 13; midi += 1) {
    if (isBlack(midi)) {
      const rightWhiteMidi = midi + 1;
      const rightWhitePhysical = Object.keys(map).find(
        (key) => map[key] === rightWhiteMidi,
      );
      if (rightWhitePhysical && topLeftMap[rightWhitePhysical]) {
        map[topLeftMap[rightWhitePhysical]] = midi;
      }
    }
  }

  const finalMap: Record<string, number> = {};
  for (const key in map) {
    if (map[key] >= scopeStart && map[key] < scopeStart + 13) {
      finalMap[key] = map[key];
    }
  }

  return finalMap;
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

export function PianoKeyboard() {
  const scopeStartMidi = useEngineStore((state) => state.scopeStartMidi);
  const setScopeStart = useEngineStore((state) => state.actions.setScopeStart);
  const [activePhysicalKeys, setActivePhysicalKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const keyMap = useMemo(
    () => getDynamicKeyMap(scopeStartMidi),
    [scopeStartMidi],
  );

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
        return;
      }

      const scopeStart = useEngineStore.getState().scopeStartMidi;
      const midi = getDynamicKeyMap(scopeStart)[event.code];
      if (midi === undefined) {
        return;
      }

      setActivePhysicalKeys((previous) => {
        if (previous.has(event.code)) {
          return previous;
        }

        const next = new Set(previous);
        next.add(event.code);
        return next;
      });
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      setActivePhysicalKeys((previous) => {
        if (!previous.has(event.code)) {
          return previous;
        }

        const next = new Set(previous);
        next.delete(event.code);
        return next;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setScopeStart]);

  return (
    <div
      className="relative flex h-40 w-full select-none overflow-hidden rounded-b-md border-t border-zinc-800 shadow-2xl"
      aria-label="88-key piano keyboard"
    >
      {whiteKeys.map((key) => {
        const inScope = isInScope(key.midi, scopeStartMidi);
        const isActive = isMidiActive(key.midi, keyMap, activePhysicalKeys);

        return (
          <div
            key={key.midi}
            className={`relative z-0 flex-1 border-r border-zinc-300 transition-colors duration-75 first:rounded-bl-md last:rounded-br-md last:border-r-0 ${
              isActive ? 'bg-zinc-300' : inScope ? 'bg-violet-100' : 'bg-white'
            }`}
          />
        );
      })}
      {blackKeys.map((key) => {
        const inScope = isInScope(key.midi, scopeStartMidi);
        const isActive = isMidiActive(key.midi, keyMap, activePhysicalKeys);

        return (
          <div
            key={key.midi}
            className={`absolute z-10 rounded-b-sm shadow-md transition-colors duration-75 ${
              isActive
                ? 'bg-zinc-600'
                : inScope
                  ? 'bg-violet-900'
                  : 'bg-zinc-900'
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
