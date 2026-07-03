/**
 * Blend factor for ONNX emission costs in the DP local cost. 0 = pure
 * rule-based DP; the model is not even loaded then.
 *
 * 150 chosen from the 2026-07-03 sweep of the PIG-trained emission model
 * (chase RH benchmark, DP-only floor 26/59): weights <= 10 leave the DP
 * unmoved (max nll ~16 vs structural penalties in the hundreds-thousands),
 * 125-150 reach 32/59 with morns pathology counts at their best, and >= 200
 * scores higher on chase but starts overriding structural DP penalties
 * (same-finger movement reappears). Keep ML costs below the hard structural
 * constraints; the DP owns transitions.
 */
export const ML_COST_WEIGHT = 150;

export function isMlFingeringEnabled(
  mlCostWeight: number = ML_COST_WEIGHT,
): boolean {
  return mlCostWeight > 0;
}
