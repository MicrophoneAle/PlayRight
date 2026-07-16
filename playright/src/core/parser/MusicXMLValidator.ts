import { z } from 'zod';
import type { PlaybackScript } from '../../types/index.ts';

/** Mirrors {@link ScriptNote} */
const ScriptNoteSchema = z.object({
  pitch: z.string().min(1),
  midi: z.number().int().min(21).max(108),
  hand: z.enum(['L', 'R']),
  finger: z.number().int().min(1).max(5).nullable(),
  fingerSource: z.enum(['score', 'predicted', 'manual']).optional(),
  durationDivisions: z.number().int().nonnegative().optional(),
  tiedToNext: z.boolean().optional(),
  hasFermata: z.boolean().optional(),
  hasStaccato: z.boolean().optional(),
  hasStaccatissimo: z.boolean().optional(),
  hasAccent: z.boolean().optional(),
  hasMarcato: z.boolean().optional(),
  hasTenuto: z.boolean().optional(),
  hasDetachedLegato: z.boolean().optional(),
});

/** Mirrors {@link GraceNoteInfo} */
const GraceNoteInfoSchema = z.object({
  midi: z.number().int().min(21).max(108),
  pitch: z.string().min(1),
  hand: z.enum(['L', 'R']),
  kind: z.enum(['acciaccatura', 'appoggiatura']),
  stealTime: z.enum(['previous', 'following']).optional(),
});

/** Mirrors {@link StepOrder} — domain field is `order`, not `orderId`. */
const StepOrderSchema = z.object({
  order: z.number().int().min(0),
  onset: z.number().int().min(0),
  measureNumber: z.number().int().min(1),
  notes: z.array(ScriptNoteSchema),
  graceBefore: z.array(GraceNoteInfoSchema).optional(),
});

/** Mirrors {@link PlaybackScript} */
const PlaybackScriptSchema = z.array(StepOrderSchema);

function formatValidationErrors(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export class MusicXMLValidator {
  static validate(data: unknown): PlaybackScript {
    const result = PlaybackScriptSchema.safeParse(data);

    if (result.success) {
      return result.data as PlaybackScript;
    }

    const details = formatValidationErrors(result.error);
    throw new Error(
      `[MusicXMLValidator] PlaybackScript validation failed: ${details}`,
    );
  }
}
