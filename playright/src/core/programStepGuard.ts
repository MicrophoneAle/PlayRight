/** Allows FingeringProgramEngine to change currentStepIndex while in program mode. */
let programStepIndexWriteDepth = 0;

export function runWithProgramStepIndexWrite<T>(fn: () => T): T {
  programStepIndexWriteDepth += 1;
  try {
    return fn();
  } finally {
    programStepIndexWriteDepth -= 1;
  }
}

export function canWriteProgramStepIndex(): boolean {
  return programStepIndexWriteDepth > 0;
}
