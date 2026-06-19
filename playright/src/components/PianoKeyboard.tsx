import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAuth } from '@clerk/react';
import {
  getLabelForKeyMapMidi,
  getScopeKeyMap,
  isMidiInDisplayScope,
  resolveNoteMidiFromKeyboard,
} from '../core/InputManager.ts';
import { getExpectedNoteForFinger } from '../core/practiceSteps.ts';
import { TWO_HAND_KEY_MAP } from '../core/twoHandMapping.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { Finger, Hand, PlaybackScript, ScriptNote } from '../types/index.ts';

const START_MIDI = 21;
const END_MIDI = 108;
const FINGER_OPTIONS: Finger[] = [1, 2, 3, 4, 5];
const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

interface StepNoteInfo {
  hand: Hand;
  midi: number;
  finger: Finger | null;
  fingerSource?: ScriptNote['fingerSource'];
}

interface SelectedStepNote {
  stepIndex: number;
  hand: Hand;
  midi: number;
}

function shiftScope(direction: 'up' | 'down'): void {
  useEngineStore.getState().actions.nudgeScope(direction);
}

interface KeyLayout {
  midi: number;
  offsetIndex: number;
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

function buildTwoHandExpectedLabels(
  script: PlaybackScript | null,
  stepIndex: number,
): Map<number, string> {
  const labels = new Map<number, string>();

  if (!script || stepIndex < 0 || stepIndex >= script.length) {
    return labels;
  }

  const step = script[stepIndex];

  for (const [physicalKey, mapping] of Object.entries(TWO_HAND_KEY_MAP)) {
    const expected = getExpectedNoteForFinger(
      step,
      mapping.hand,
      mapping.finger,
    );
    if (expected !== null) {
      labels.set(expected.midi, physicalKey);
    }
  }

  return labels;
}

function buildTwoHandStepNotesByMidi(
  script: PlaybackScript | null,
  stepIndex: number,
): Map<number, StepNoteInfo[]> {
  const byMidi = new Map<number, StepNoteInfo[]>();

  if (!script || stepIndex < 0 || stepIndex >= script.length) {
    return byMidi;
  }

  for (const note of script[stepIndex].notes) {
    const existing = byMidi.get(note.midi) ?? [];
    existing.push({
      hand: note.hand,
      midi: note.midi,
      finger: note.finger,
      fingerSource: note.fingerSource,
    });
    byMidi.set(note.midi, existing);
  }

  return byMidi;
}

function fingerLabelClass(
  source: ScriptNote['fingerSource'] | undefined,
  onBlackKey: boolean,
): string {
  const base = 'absolute top-1 w-full text-center text-[10px] leading-none';

  if (source === 'predicted') {
    return `${base} font-normal italic ${onBlackKey ? 'text-zinc-400' : 'text-zinc-500'}`;
  }

  if (source === 'manual') {
    return `${base} font-bold ${onBlackKey ? 'text-violet-300' : 'text-violet-700'}`;
  }

  return `${base} font-bold ${onBlackKey ? 'text-zinc-200' : 'text-zinc-800'}`;
}

function getWhiteKeyClasses(
  inScope: boolean,
  isExpected: boolean,
  isActive: boolean,
  isSelected: boolean,
): string {
  const base =
    'relative z-0 flex-1 border-r border-zinc-300 transition-[transform,box-shadow,background-color] duration-75 first:rounded-bl-md last:rounded-br-md last:border-r-0';

  const selectedRing = isSelected ? ' ring-2 ring-inset ring-amber-400' : '';

  if (isActive && isExpected) {
    return `${base} translate-y-[3px] bg-emerald-300 shadow-[inset_0_3px_6px_rgba(5,150,105,0.45)] ring-2 ring-inset ring-emerald-500`;
  }
  if (isActive) {
    return `${base} translate-y-[3px] bg-zinc-300 shadow-inner`;
  }
  if (isExpected) {
    return `${base} bg-emerald-100 ring-2 ring-inset ring-emerald-400${selectedRing}`;
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
  isSelected: boolean,
): string {
  const base =
    'absolute z-10 rounded-b-sm shadow-md transition-[transform,box-shadow,background-color] duration-75';

  const selectedRing = isSelected ? ' ring-2 ring-inset ring-amber-300' : '';

  if (isActive && isExpected) {
    return `${base} translate-y-[2px] bg-emerald-950 shadow-[inset_0_4px_8px_rgba(6,78,59,0.8)] ring-2 ring-inset ring-emerald-400`;
  }
  if (isActive) {
    return `${base} translate-y-[2px] bg-zinc-600 shadow-inner`;
  }
  if (isExpected) {
    return `${base} bg-emerald-800 ring-2 ring-inset ring-emerald-400${selectedRing}`;
  }
  if (inScope) {
    return `${base} bg-violet-900`;
  }
  return `${base} bg-zinc-900`;
}

export function PianoKeyboard() {
  const scopeStartMidi = useEngineStore((state) => state.scopeStartMidi);
  const scopeTranspose = useEngineStore((state) => state.scopeTranspose);
  const expectedMidiNotes = useEngineStore((state) => state.expectedMidiNotes);
  const isPracticeActive = useEngineStore((state) => state.isPracticeActive);
  const engineMode = useEngineStore((state) => state.engineMode);
  const script = useEngineStore((state) => state.script);
  const currentStepIndex = useEngineStore((state) => state.currentStepIndex);
  const manualFingerings = useEngineStore((state) => state.manualFingerings);
  const setManualFinger = useEngineStore((state) => state.actions.setManualFinger);
  const clearManualFinger = useEngineStore(
    (state) => state.actions.clearManualFinger,
  );
  const { userId } = useAuth();
  const isTwoHand = engineMode === 'two-hand';
  const [activePhysicalKeys, setActivePhysicalKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedNote, setSelectedNote] = useState<SelectedStepNote | null>(
    null,
  );

  const keyMap = useMemo(
    () => getScopeKeyMap(scopeStartMidi, scopeTranspose),
    [scopeStartMidi, scopeTranspose],
  );

  const expectedMidiSet = useMemo(
    () => new Set(expectedMidiNotes),
    [expectedMidiNotes],
  );

  const isKeyInDisplayRange = (midi: number) => {
    if (isTwoHand) {
      return false;
    }

    return isMidiInDisplayScope(midi, scopeStartMidi);
  };

  const twoHandMidiLabels = useMemo(() => {
    if (!isTwoHand) {
      return null;
    }

    return buildTwoHandExpectedLabels(script, currentStepIndex);
  }, [isTwoHand, script, currentStepIndex]);

  const twoHandStepNotesByMidi = useMemo(() => {
    if (!isTwoHand) {
      return null;
    }

    return buildTwoHandStepNotesByMidi(script, currentStepIndex);
  }, [isTwoHand, script, currentStepIndex]);

  const selectedHasManualOverride = useMemo(() => {
    if (!selectedNote) {
      return false;
    }

    const key = `${selectedNote.stepIndex}:${selectedNote.hand}:${selectedNote.midi}`;
    return Object.prototype.hasOwnProperty.call(manualFingerings, key);
  }, [manualFingerings, selectedNote]);

  const mappedLabelForMidi = (midi: number, onBlackPianoKey: boolean) => {
    if (!isKeyInDisplayRange(midi)) {
      return undefined;
    }

    return isTwoHand
      ? twoHandMidiLabels?.get(midi)
      : getLabelForKeyMapMidi(midi, onBlackPianoKey, keyMap);
  };

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
    setSelectedNote(null);
  }, [currentStepIndex]);

  useEffect(() => {
    if (isTwoHand) {
      setActivePhysicalKeys(new Set());
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.code === 'Digit2') {
        event.preventDefault();
        shiftScope('up');
        return;
      }

      if (event.key === 'ArrowLeft' || event.code === 'Digit1') {
        event.preventDefault();
        shiftScope('down');
        return;
      }

      if (event.key === 'ArrowUp' || event.code === 'Digit3') {
        event.preventDefault();
        useEngineStore.getState().actions.cycleShiftMode('up');
        return;
      }

      const midi = resolveNoteMidiFromKeyboard(event, keyMap);
      if (midi === undefined) {
        return;
      }

      const physicalCode =
        Object.entries(keyMap).find(([, mappedMidi]) => mappedMidi === midi)?.[0] ??
        event.code;

      flushSync(() => {
        setActivePhysicalKeys((previous) => {
          if (previous.has(physicalCode)) {
            return previous;
          }

          const next = new Set(previous);
          next.add(physicalCode);
          return next;
        });
      });
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const midi = resolveNoteMidiFromKeyboard(event, keyMap);
      const physicalCode =
        midi === undefined
          ? event.code
          : (Object.entries(keyMap).find(([, mappedMidi]) => mappedMidi === midi)?.[0] ??
            event.code);

      flushSync(() => {
        setActivePhysicalKeys((previous) => {
          if (!previous.has(physicalCode)) {
            return previous;
          }

          const next = new Set(previous);
          next.delete(physicalCode);
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
  }, [isTwoHand, keyMap]);

  const handleTwoHandKeySelect = (midi: number) => {
    const stepNotes = twoHandStepNotesByMidi?.get(midi);
    if (!stepNotes?.length) {
      return;
    }

    const note = stepNotes[0];
    setSelectedNote({
      stepIndex: currentStepIndex,
      hand: note.hand,
      midi: note.midi,
    });
  };

  const handleAssignFinger = (finger: Finger) => {
    if (!selectedNote) {
      return;
    }

    setManualFinger(
      selectedNote.stepIndex,
      selectedNote.hand,
      selectedNote.midi,
      finger,
      userId,
    );
  };

  const handleClearManualFinger = () => {
    if (!selectedNote) {
      return;
    }

    clearManualFinger(
      selectedNote.stepIndex,
      selectedNote.hand,
      selectedNote.midi,
      userId,
    );
  };

  const renderFingerLabel = (midi: number, onBlack: boolean) => {
    const stepNotes = twoHandStepNotesByMidi?.get(midi);
    const note = stepNotes?.[0];

    if (!note || note.finger === null) {
      return null;
    }

    return (
      <span className={fingerLabelClass(note.fingerSource, onBlack)}>
        {note.finger}
      </span>
    );
  };

  const isNoteSelected = (midi: number) =>
    selectedNote !== null &&
    selectedNote.midi === midi &&
    selectedNote.stepIndex === currentStepIndex;

  return (
    <div className="relative">
      {isTwoHand && selectedNote ? (
        <div
          className="absolute -top-10 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 shadow-lg"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span className="mr-1 text-[10px] text-zinc-500">Finger</span>
          {FINGER_OPTIONS.map((finger) => (
            <button
              key={finger}
              type="button"
              onClick={() => handleAssignFinger(finger)}
              className="inline-flex h-6 w-6 items-center justify-center rounded border border-zinc-600 bg-zinc-800 text-xs font-medium text-zinc-200 transition-colors hover:border-violet-500 hover:bg-violet-600 hover:text-white"
            >
              {finger}
            </button>
          ))}
          {selectedHasManualOverride ? (
            <button
              type="button"
              onClick={handleClearManualFinger}
              className="ml-1 rounded border border-zinc-600 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className="relative flex h-32 w-full select-none overflow-hidden rounded-b-md border-t border-zinc-800 shadow-2xl"
        aria-label="88-key piano keyboard"
      >
        {whiteKeys.map((key) => {
          const inScope = isKeyInDisplayRange(key.midi);
          const isActive = isTwoHand
            ? false
            : isMidiActive(key.midi, keyMap, activePhysicalKeys);
          const isExpected = isTwoHand
            ? (twoHandMidiLabels?.has(key.midi) ?? false)
            : isPracticeActive &&
              expectedMidiSet.has(key.midi) &&
              isKeyInDisplayRange(key.midi);
          const mappedLetter = mappedLabelForMidi(key.midi, false);
          const isEditable = isTwoHand && (twoHandStepNotesByMidi?.has(key.midi) ?? false);
          const isSelected = isNoteSelected(key.midi);

          return (
            <div
              key={key.midi}
              role={isEditable ? 'button' : undefined}
              tabIndex={isEditable ? 0 : undefined}
              onClick={isEditable ? () => handleTwoHandKeySelect(key.midi) : undefined}
              onKeyDown={
                isEditable
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleTwoHandKeySelect(key.midi);
                      }
                    }
                  : undefined
              }
              className={`${getWhiteKeyClasses(inScope, isExpected, isActive, isSelected)}${isEditable ? ' cursor-pointer' : ''}`}
            >
              {isTwoHand ? renderFingerLabel(key.midi, false) : null}
              {mappedLetter ? (
                <span className="absolute bottom-2 w-full text-center text-xs font-bold text-zinc-800">
                  {mappedLetter}
                </span>
              ) : null}
            </div>
          );
        })}
        {blackKeys.map((key) => {
          const inScope = isKeyInDisplayRange(key.midi);
          const isActive = isTwoHand
            ? false
            : isMidiActive(key.midi, keyMap, activePhysicalKeys);
          const isExpected = isTwoHand
            ? (twoHandMidiLabels?.has(key.midi) ?? false)
            : isPracticeActive &&
              expectedMidiSet.has(key.midi) &&
              isKeyInDisplayRange(key.midi);
          const mappedLetter = mappedLabelForMidi(key.midi, true);
          const isEditable = isTwoHand && (twoHandStepNotesByMidi?.has(key.midi) ?? false);
          const isSelected = isNoteSelected(key.midi);

          return (
            <div
              key={key.midi}
              role={isEditable ? 'button' : undefined}
              tabIndex={isEditable ? 0 : undefined}
              onClick={isEditable ? () => handleTwoHandKeySelect(key.midi) : undefined}
              onKeyDown={
                isEditable
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleTwoHandKeySelect(key.midi);
                      }
                    }
                  : undefined
              }
              className={`${getBlackKeyClasses(inScope, isExpected, isActive, isSelected)}${isEditable ? ' cursor-pointer' : ''}`}
              style={{
                left: `calc(${(key.offsetIndex / 52) * 100}%)`,
                transform: 'translateX(-50%)',
                width: 'calc(100% / 52 * 0.65)',
                height: '65%',
              }}
            >
              {isTwoHand ? renderFingerLabel(key.midi, true) : null}
              {mappedLetter ? (
                <span className="absolute bottom-2 w-full text-center text-xs font-bold text-zinc-200">
                  {mappedLetter}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
