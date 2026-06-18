type HeldKeyReconciler = () => void;

let heldKeyReconciler: HeldKeyReconciler | null = null;

export function setHeldKeyReconciler(reconciler: HeldKeyReconciler | null): void {
  heldKeyReconciler = reconciler;
}

export function reconcileHeldPracticeKeys(): void {
  heldKeyReconciler?.();
}
