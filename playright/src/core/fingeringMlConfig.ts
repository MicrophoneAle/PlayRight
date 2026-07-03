/**
 * Blend factor for ONNX finger costs in the DP local cost.
 * 0 = pure rule-based DP (production default).
 */
export const ML_COST_WEIGHT = 0;

export function isMlFingeringEnabled(
  mlCostWeight: number = ML_COST_WEIGHT,
): boolean {
  return mlCostWeight > 0;
}
