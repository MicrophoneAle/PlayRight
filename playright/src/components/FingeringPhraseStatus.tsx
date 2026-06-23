import { useMemo } from 'react';
import type { PlaybackScript } from '../types/index.ts';
import {
  buildFingeringPhraseInfos,
  findFingeringPhraseForStep,
  formatFingeringPhraseSummary,
} from '../core/fingeringPredictor.ts';

interface FingeringPhraseStatusProps {
  script: PlaybackScript;
  stepIndex: number;
}

function PhraseLine({
  hand,
  phraseIndex,
  span,
  summary,
}: {
  hand: 'L' | 'R';
  phraseIndex: number;
  span: number;
  summary: string;
}) {
  return (
    <p className="text-left text-[11px] leading-snug text-zinc-500 sm:text-xs">
      <span className="font-medium text-zinc-400">
        {hand === 'L' ? 'LH' : 'RH'} phrase {phraseIndex}
      </span>
      <span className="text-zinc-600"> · span {span} · </span>
      <span className="text-zinc-500">{summary}</span>
    </p>
  );
}

export function FingeringPhraseStatus({
  script,
  stepIndex,
}: FingeringPhraseStatusProps) {
  const phraseInfos = useMemo(
    () => buildFingeringPhraseInfos(script),
    [script],
  );

  const leftPhrase = useMemo(
    () => findFingeringPhraseForStep(phraseInfos.L, stepIndex),
    [phraseInfos.L, stepIndex],
  );

  const rightPhrase = useMemo(
    () => findFingeringPhraseForStep(phraseInfos.R, stepIndex),
    [phraseInfos.R, stepIndex],
  );

  if (!leftPhrase && !rightPhrase) {
    return null;
  }

  return (
    <div className="mx-auto mt-1 max-w-5xl space-y-0.5 px-1">
      {rightPhrase ? (
        <PhraseLine
          hand="R"
          phraseIndex={rightPhrase.phraseIndex}
          span={rightPhrase.span}
          summary={formatFingeringPhraseSummary(rightPhrase)}
        />
      ) : null}
      {leftPhrase ? (
        <PhraseLine
          hand="L"
          phraseIndex={leftPhrase.phraseIndex}
          span={leftPhrase.span}
          summary={formatFingeringPhraseSummary(leftPhrase)}
        />
      ) : null}
    </div>
  );
}
