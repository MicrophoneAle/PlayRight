import { useMemo } from 'react';

const START_MIDI = 21;
const END_MIDI = 108;
const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

interface KeyLayout {
  midi: number;
  offsetIndex: number;
}

export function PianoKeyboard() {
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

  return (
    <div
      className="relative flex h-40 w-full select-none overflow-hidden rounded-b-md border-t border-zinc-800 shadow-2xl"
      aria-label="88-key piano keyboard"
    >
      {whiteKeys.map((key) => (
        <div
          key={key.midi}
          className="relative z-0 flex-1 border-r border-zinc-300 bg-white transition-colors duration-75 first:rounded-bl-md last:rounded-br-md last:border-r-0 hover:bg-zinc-100"
        />
      ))}
      {blackKeys.map((key) => (
        <div
          key={key.midi}
          className="absolute z-10 rounded-b-sm bg-zinc-900 shadow-md transition-colors duration-75 hover:bg-zinc-700"
          style={{
            left: `calc(${(key.offsetIndex / 52) * 100}%)`,
            transform: 'translateX(-50%)',
            width: 'calc(100% / 52 * 0.65)',
            height: '65%',
          }}
        />
      ))}
    </div>
  );
}
