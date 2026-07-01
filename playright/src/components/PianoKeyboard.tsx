import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAuth } from '@clerk/react';
import {
  getLabelForKeyMapMidi,
  getScopeKeyMap,
  expectedMidisMissingPhysicalKey,
  expectedMidisOutsideDisplayScope,
  isMidiInDisplayScope,
  resolveNoteMidiFromKeyboard,
} from '../core/InputManager.ts';
import {
  buildTwoHandExpectedMidis,
  buildTwoHandPhysicalKeysByMidi,
  buildTwoHandStepNotesByMidi,
  buildProgramAssignedKeys,
  programAssignmentKey,
  programAssignmentProgress,
  programNextUnassignedNote,
  programTargetMidis,
  type TwoHandStepNoteInfo,
} from '../core/practiceSteps.ts';
import { getFingerMappingFromKeyboard } from '../core/twoHandMapping.ts';
import { useEngineStore } from '../store/useEngineStore.ts';
import type { Finger, Hand, ScriptNote } from '../types/index.ts';
import { fingeringKey } from '../types/index.ts';

const START_MIDI = 21;
const END_MIDI = 108;
const FINGER_OPTIONS: Finger[] = [1, 2, 3, 4, 5];
const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

interface SelectedStepNote {
  onset: number;
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

function twoHandFingerKey(hand: Hand, finger: Finger): string {
  return `${hand}:${finger}`;
}

function isTwoHandMidiHeld(
  midi: number,
  stepNotesByMidi: Map<number, TwoHandStepNoteInfo[]> | null,
  activeTwoHandFingers: ReadonlySet<string>,
): boolean {
  if (!stepNotesByMidi) {
    return false;
  }

  const notes = stepNotesByMidi.get(midi) ?? [];
  return notes.some(
    (note) =>
      note.finger !== null &&
      activeTwoHandFingers.has(twoHandFingerKey(note.hand, note.finger)),
  );
}

function formatTwoHandKeyLabel(physicalKey: string): string {
  if (physicalKey === '[') {
    return '[';
  }

  return physicalKey.toUpperCase();
}

function oneHandKeyLabelClass(onBlackKey: boolean): string {
  return `text-xs font-bold ${onBlackKey ? 'text-zinc-200' : 'text-zinc-800'}`;
}

function twoHandFingerLabelClass(
  source: ScriptNote['fingerSource'] | undefined,
  onBlackKey: boolean,
): string {
  if (source === 'predicted') {
    return `text-xs font-normal italic ${onBlackKey ? 'text-zinc-300' : 'text-zinc-600'}`;
  }

  if (source === 'manual') {
    return `text-xs font-bold ${onBlackKey ? 'text-violet-300' : 'text-violet-700'}`;
  }

  return oneHandKeyLabelClass(onBlackKey);
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

function getKeyHighlightState(
  midi: number,
  options: {
    playMode: boolean;
    isPlaybackActive: boolean;
    isPracticeActive: boolean;
    isTwoHand: boolean;
    playingMidiCounts: Map<number, number>;
    expectedMidiSet: Set<number>;
    showStepKeyHighlight: boolean;
    isKeyInDisplayRange: (midi: number) => boolean;
    twoHandExpectedMidis: Set<number> | null;
    isPhysicallyActive: boolean;
  },
): { isExpected: boolean; isPressed: boolean } {
  const {
    playMode,
    isPlaybackActive,
    isTwoHand,
    playingMidiCounts,
    expectedMidiSet,
    showStepKeyHighlight,
    twoHandExpectedMidis,
    isPhysicallyActive,
  } = options;

  if (playMode && isPlaybackActive) {
    const isSounding = (playingMidiCounts.get(midi) ?? 0) > 0;
    return { isExpected: isSounding, isPressed: isSounding };
  }

  if (isTwoHand) {
    const isExpected = twoHandExpectedMidis?.has(midi) ?? false;
    return { isExpected, isPressed: isPhysicallyActive };
  }

  const isExpected = showStepKeyHighlight && expectedMidiSet.has(midi);

  return { isExpected, isPressed: isPhysicallyActive };
}

export function PianoKeyboard() {
  const scopeStartMidi = useEngineStore((state) => state.scopeStartMidi);
  const scopeTranspose = useEngineStore((state) => state.scopeTranspose);
  const expectedMidiNotes = useEngineStore((state) => state.expectedMidiNotes);
  const playingMidiNotes = useEngineStore((state) => state.playingMidiNotes);
  const isPracticeActive = useEngineStore((state) => state.isPracticeActive);
  const playMode = useEngineStore((state) => state.playMode);
  const isPlaybackActive = useEngineStore((state) => state.isPlaybackActive);
  const engineMode = useEngineStore((state) => state.engineMode);
  const fingeringMode = useEngineStore((state) => state.fingeringMode);
  const script = useEngineStore((state) => state.script);
  const currentStepIndex = useEngineStore((state) => state.currentStepIndex);
  const totalSteps = useEngineStore((state) => state.totalSteps);
  const manualFingerings = useEngineStore((state) => state.manualFingerings);
  const programRefingerNoteIndex = useEngineStore((state) => state.programRefingerNoteIndex);
  const setManualFinger = useEngineStore((state) => state.actions.setManualFinger);
  const clearManualFinger = useEngineStore(
    (state) => state.actions.clearManualFinger,
  );
  const { userId } = useAuth();
  const isTwoHand = engineMode === 'two-hand' || fingeringMode !== 'off';
  const isProgramMode = fingeringMode === 'program';
  const [activePhysicalKeys, setActivePhysicalKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeTwoHandFingers, setActiveTwoHandFingers] = useState<Set<string>>(
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

  const playingMidiCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const midi of playingMidiNotes) {
      counts.set(midi, (counts.get(midi) ?? 0) + 1);
    }
    return counts;
  }, [playingMidiNotes]);

  const showStepKeyHighlight =
    (!playMode && isPracticeActive) || (playMode && isPlaybackActive);

  const isKeyInDisplayRange = (midi: number) => {
    if (isTwoHand) {
      return false;
    }

    return isMidiInDisplayScope(midi, scopeStartMidi);
  };

  const programAssignedSet = useMemo(() => {
    if (!isProgramMode || !script || currentStepIndex < 0 || currentStepIndex >= script.length) {
      return new Set<string>();
    }

    return buildProgramAssignedKeys(script[currentStepIndex], manualFingerings);
  }, [isProgramMode, script, currentStepIndex, manualFingerings]);

  const programTargetMidiSet = useMemo(() => {
    if (!isProgramMode || !script || currentStepIndex < 0 || currentStepIndex >= script.length) {
      return new Set<number>();
    }

    if (programRefingerNoteIndex !== null) {
      const note = script[currentStepIndex].notes[programRefingerNoteIndex];
      return note ? new Set([note.midi]) : new Set();
    }

    return programTargetMidis(script[currentStepIndex], programAssignedSet);
  }, [isProgramMode, script, currentStepIndex, programAssignedSet, programRefingerNoteIndex]);

  const twoHandExpectedMidis = useMemo(() => {
    if (!isTwoHand) {
      return null;
    }

    return buildTwoHandExpectedMidis(script, currentStepIndex);
  }, [isTwoHand, script, currentStepIndex]);

  const twoHandStepNotesByMidi = useMemo(() => {
    if (!isTwoHand) {
      return null;
    }

    return buildTwoHandStepNotesByMidi(script, currentStepIndex);
  }, [isTwoHand, script, currentStepIndex]);

  const twoHandPhysicalKeysByMidi = useMemo(() => {
    if (!isTwoHand) {
      return null;
    }

    return buildTwoHandPhysicalKeysByMidi(script, currentStepIndex);
  }, [isTwoHand, script, currentStepIndex]);

  const oneHandExpectedCoverage = useMemo(() => {
    if (isTwoHand || playMode || expectedMidiNotes.length === 0) {
      return { missingPhysicalKey: [] as number[], outsideDisplayScope: [] as number[] };
    }

    return {
      missingPhysicalKey: expectedMidisMissingPhysicalKey(
        expectedMidiNotes,
        scopeStartMidi,
        scopeTranspose,
      ),
      outsideDisplayScope: expectedMidisOutsideDisplayScope(
        expectedMidiNotes,
        scopeStartMidi,
      ),
    };
  }, [
    expectedMidiNotes,
    isTwoHand,
    playMode,
    scopeStartMidi,
    scopeTranspose,
  ]);

  const selectedHasManualOverride = useMemo(() => {
    if (!selectedNote) {
      return false;
    }

    return Object.prototype.hasOwnProperty.call(
      manualFingerings,
      fingeringKey(selectedNote.onset, selectedNote.hand, selectedNote.midi),
    );
  }, [manualFingerings, selectedNote]);

  const programNextNote = useMemo(() => {
    if (!isProgramMode || !script || currentStepIndex < 0 || currentStepIndex >= script.length) {
      return null;
    }

    const step = script[currentStepIndex];
    if (programRefingerNoteIndex !== null) {
      return step.notes[programRefingerNoteIndex] ?? null;
    }

    return programNextUnassignedNote(step, programAssignedSet);
  }, [isProgramMode, script, currentStepIndex, programAssignedSet, programRefingerNoteIndex]);

  const programTargetByHand = useMemo(() => {
    if (!programNextNote) {
      return { L: null as ScriptNote | null, R: null as ScriptNote | null };
    }

    return {
      L: programNextNote.hand === 'L' ? programNextNote : null,
      R: programNextNote.hand === 'R' ? programNextNote : null,
    };
  }, [programNextNote]);

  const programProgress = useMemo(() => {
    if (!isProgramMode || !script || currentStepIndex < 0 || currentStepIndex >= script.length) {
      return null;
    }

    return programAssignmentProgress(script[currentStepIndex], programAssignedSet);
  }, [isProgramMode, script, currentStepIndex, programAssignedSet]);

  const mappedLabelForMidi = (midi: number, onBlackPianoKey: boolean) => {
    if (playMode || !isKeyInDisplayRange(midi)) {
      return undefined;
    }

    return isTwoHand
      ? twoHandPhysicalKeysByMidi?.get(midi)?.[0]
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
    setActiveTwoHandFingers(new Set());
  }, [currentStepIndex]);

  useEffect(() => {
    if (isTwoHand) {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.repeat) {
          return;
        }

        const mapping = getFingerMappingFromKeyboard(event);
        if (mapping !== null) {
          flushSync(() => {
            setActiveTwoHandFingers((previous) => {
              const fingerKey = twoHandFingerKey(mapping.hand, mapping.finger);
              if (previous.has(fingerKey)) {
                return previous;
              }

              const next = new Set(previous);
              next.add(fingerKey);
              return next;
            });
          });
        }
      };

      const handleKeyUp = (event: KeyboardEvent) => {
        const mapping = getFingerMappingFromKeyboard(event);
        if (mapping === null) {
          return;
        }

        flushSync(() => {
          setActiveTwoHandFingers((previous) => {
            const fingerKey = twoHandFingerKey(mapping.hand, mapping.finger);
            if (!previous.has(fingerKey)) {
              return previous;
            }

            const next = new Set(previous);
            next.delete(fingerKey);
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
    }

    setActiveTwoHandFingers(new Set());

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

  const handleTwoHandKeySelect = (midi: number, hand?: Hand) => {
    if (isProgramMode) {
      return;
    }

    const stepNotes = twoHandStepNotesByMidi?.get(midi);
    if (!stepNotes?.length) {
      return;
    }

    const step = script?.[currentStepIndex];
    if (!step) {
      return;
    }

    const note =
      hand !== undefined
        ? stepNotes.find((entry) => entry.hand === hand) ?? stepNotes[0]
        : stepNotes.length === 1
          ? stepNotes[0]
          : stepNotes[0];

    setSelectedNote({
      onset: step.onset,
      hand: note.hand,
      midi: note.midi,
    });
  };

  const handleAssignFinger = (finger: Finger) => {
    if (isProgramMode || !selectedNote) {
      return;
    }

    setManualFinger(selectedNote.onset, selectedNote.hand, selectedNote.midi, finger, userId);
  };

  const handleClearManualFinger = () => {
    if (!selectedNote) {
      return;
    }

    clearManualFinger(selectedNote.onset, selectedNote.hand, selectedNote.midi, userId);
  };

  const renderTwoHandHint = (midi: number, onBlack: boolean) => {
    const stepNotes = twoHandStepNotesByMidi?.get(midi) ?? [];
    const physicalKeys = twoHandPhysicalKeysByMidi?.get(midi) ?? [];

    if (stepNotes.length === 0) {
      return null;
    }

    return (
      <div className="absolute bottom-2 flex w-full flex-col items-center gap-px leading-none">
        {stepNotes.map((note, index) => {
          const showLabel = note.finger !== null || isProgramMode;
          if (!showLabel) {
            return null;
          }

          const isProgramTarget =
            isProgramMode &&
            programTargetByHand[note.hand]?.midi === midi &&
            !programAssignedSet.has(programAssignmentKey(note.hand, note.midi));

          return (
            <button
              key={`${note.hand}:${note.finger}:${index}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleTwoHandKeySelect(midi, note.hand);
              }}
              className={`rounded px-0.5 ${twoHandFingerLabelClass(note.fingerSource, onBlack)} ${
                selectedNote?.hand === note.hand && selectedNote?.midi === midi
                  ? 'ring-1 ring-violet-400'
                  : ''
              } ${isProgramTarget ? 'animate-pulse ring-2 ring-amber-400' : ''}`}
            >
              {note.finger ?? (isProgramMode ? '•' : '?')}
            </button>
          );
        })}
        {physicalKeys.map((physicalKey) => (
          <span
            key={physicalKey}
            className={oneHandKeyLabelClass(onBlack)}
          >
            {formatTwoHandKeyLabel(physicalKey)}
          </span>
        ))}
      </div>
    );
  };

  const isNoteSelected = (midi: number, hand?: Hand) => {
    return (
      selectedNote !== null &&
      selectedNote.midi === midi &&
      script?.[currentStepIndex]?.onset === selectedNote.onset &&
      (hand === undefined || selectedNote.hand === hand)
    );
  };

  const highlightOptions = {
    playMode,
    isPlaybackActive,
    isPracticeActive,
    isTwoHand,
    playingMidiCounts,
    expectedMidiSet,
    showStepKeyHighlight,
    isKeyInDisplayRange,
    twoHandExpectedMidis,
  };

  const showOneHandCoverageNotice =
    !isTwoHand &&
    !playMode &&
    isPracticeActive &&
    (oneHandExpectedCoverage.outsideDisplayScope.length > 0 ||
      oneHandExpectedCoverage.missingPhysicalKey.length > 0);

  return (
    <div className="relative">
      {isProgramMode ? (
        <div
          className="mb-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-center text-[11px] text-amber-100"
          role="status"
        >
          Program step {currentStepIndex + 1} / {totalSteps}
          {programProgress ? (
            <span className="ml-2">
              LH {programProgress.assignedCounts.L}/{programProgress.needed.L} · RH{' '}
              {programProgress.assignedCounts.R}/{programProgress.needed.R}
            </span>
          ) : null}
          {programNextNote ? (
            <span className="ml-2">
              Next: {programNextNote.hand} {programNextNote.pitch ?? `MIDI ${programNextNote.midi}`}
            </span>
          ) : null}
          {script && currentStepIndex + 1 < totalSteps ? (
            <span className="ml-2 text-amber-200/70">
              Upcoming step {currentStepIndex + 2}
            </span>
          ) : null}
          <span className="ml-2 text-amber-200/80">
            Assign each note in score order before advancing
          </span>
        </div>
      ) : null}
      {showOneHandCoverageNotice ? (
        <div
          className="mb-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-center text-[11px] text-amber-200"
          role="status"
        >
          {oneHandExpectedCoverage.outsideDisplayScope.length > 0
            ? 'An expected note is outside the current scope window — use ← / → or 1 / 2 to shift.'
            : 'An expected note has no keyboard key in the current window — shift scope to reach it.'}
        </div>
      ) : null}
      {isTwoHand && !isProgramMode && selectedNote ? (
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
          const isPhysicallyActive = isTwoHand
            ? isTwoHandMidiHeld(key.midi, twoHandStepNotesByMidi, activeTwoHandFingers)
            : isMidiActive(key.midi, keyMap, activePhysicalKeys);
          const { isExpected, isPressed } = getKeyHighlightState(key.midi, {
            ...highlightOptions,
            isPhysicallyActive,
          });
          const showScopeHighlight = !playMode && inScope;
          const mappedLetter = mappedLabelForMidi(key.midi, false);
          const isEditable = isTwoHand && (twoHandStepNotesByMidi?.has(key.midi) ?? false);
          const isSelected = isNoteSelected(key.midi);
          const isProgramTarget = isProgramMode && programTargetMidiSet.has(key.midi);

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
              className={`${getWhiteKeyClasses(showScopeHighlight, isExpected, isPressed, isSelected)}${isEditable ? ' cursor-pointer' : ''}${isProgramTarget ? ' ring-2 ring-inset ring-amber-400' : ''}`}
            >
              {isTwoHand ? renderTwoHandHint(key.midi, false) : null}
              {!isTwoHand && mappedLetter ? (
                <span
                  className={`absolute bottom-2 w-full text-center ${oneHandKeyLabelClass(false)}`}
                >
                  {mappedLetter}
                </span>
              ) : null}
            </div>
          );
        })}
        {blackKeys.map((key) => {
          const inScope = isKeyInDisplayRange(key.midi);
          const isPhysicallyActive = isTwoHand
            ? isTwoHandMidiHeld(key.midi, twoHandStepNotesByMidi, activeTwoHandFingers)
            : isMidiActive(key.midi, keyMap, activePhysicalKeys);
          const { isExpected, isPressed } = getKeyHighlightState(key.midi, {
            ...highlightOptions,
            isPhysicallyActive,
          });
          const showScopeHighlight = !playMode && inScope;
          const mappedLetter = mappedLabelForMidi(key.midi, true);
          const isEditable = isTwoHand && (twoHandStepNotesByMidi?.has(key.midi) ?? false);
          const isSelected = isNoteSelected(key.midi);
          const isProgramTarget = isProgramMode && programTargetMidiSet.has(key.midi);

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
              className={`${getBlackKeyClasses(showScopeHighlight, isExpected, isPressed, isSelected)}${isEditable ? ' cursor-pointer' : ''}${isProgramTarget ? ' ring-2 ring-inset ring-amber-400' : ''}`}
              style={{
                left: `calc(${(key.offsetIndex / 52) * 100}%)`,
                transform: 'translateX(-50%)',
                width: 'calc(100% / 52 * 0.65)',
                height: '65%',
              }}
            >
              {isTwoHand ? renderTwoHandHint(key.midi, true) : null}
              {!isTwoHand && mappedLetter ? (
                <span
                  className={`absolute bottom-2 w-full text-center ${oneHandKeyLabelClass(true)}`}
                >
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
