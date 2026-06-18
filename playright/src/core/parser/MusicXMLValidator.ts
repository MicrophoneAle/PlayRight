import { z } from 'zod';
import type { PlaybackScript } from '../../types/index.ts';

/** Mirrors {@link ScriptNote} */
const ScriptNoteSchema = z.object({
  pitch: z.string().min(1),
  midi: z.number().int().min(0).max(127),
  hand: z.enum(['L', 'R']),
  finger: z.number().int().min(0).max(5),
});

/** Mirrors {@link StepOrder} — domain field is `order`, not `orderId`. */
const StepOrderSchema = z.object({
  order: z.number().int().min(0),
  onset: z.number().int().min(0),
  notes: z.array(ScriptNoteSchema),
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
