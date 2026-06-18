import type {
  EngineMode,
  Finger,
  Hand,
  PlaybackScript,
  ScriptNote,
  StepOrder,
} from '../types/index.ts';

export function getPracticeNotes(
  step: StepOrder,
  engineMode: EngineMode,
  activeHand: Hand,
): ScriptNote[] {
  if (engineMode !== 'one-hand') {
    return step.notes;
  }

  return step.notes.filter((note) => note.hand === activeHand);
}

export function stepHasPracticeNotes(
  step: StepOrder,
  engineMode: EngineMode,
  activeHand: Hand,
): boolean {
  return getPracticeNotes(step, engineMode, activeHand).length > 0;
}

export function countPracticeSteps(
  script: PlaybackScript,
  engineMode: EngineMode,
  activeHand: Hand,
): number {
  if (engineMode !== 'one-hand') {
    return script.length;
  }

  return script.filter((step) => stepHasPracticeNotes(step, engineMode, activeHand))
    .length;
}

export function countCompletedPracticeSteps(
  script: PlaybackScript,
  engineMode: EngineMode,
  activeHand: Hand,
  currentStepIndex: number,
): number {
  if (engineMode !== 'one-hand') {
    return currentStepIndex;
  }

  return script
    .slice(0, currentStepIndex)
    .filter((step) => stepHasPracticeNotes(step, engineMode, activeHand)).length;
}

export function getExpectedNoteForFinger(
  step: StepOrder,
  hand: Hand,
  finger: Finger,
): ScriptNote | null {
  return (
    step.notes.find((note) => note.hand === hand && note.finger === finger) ?? null
  );
}
