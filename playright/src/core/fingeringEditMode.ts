import { useEngineStore } from '../store/useEngineStore.ts';
import type { FingerMapping } from './twoHandMapping.ts';

/** Assign the pressed finger to the selected note; opposite-hand presses crossover. */
export function handleEditModeFingerPress(
  mapping: FingerMapping,
  userId?: string | null,
): void {
  const state = useEngineStore.getState();
  if (state.fingeringMode !== 'edit') {
    return;
  }

  const selected = state.selectedFingeringNote;
  if (selected === null) {
    return;
  }

  const { actions } = state;
  const { onset, hand, midi } = selected;

  if (mapping.hand !== hand) {
    actions.setManualFingerCrossover(onset, hand, midi, mapping.hand, mapping.finger, userId);
    actions.setSelectedFingeringNote({
      ...selected,
      hand: mapping.hand,
    });
    return;
  }

  actions.setManualFinger(onset, hand, midi, mapping.finger, userId);
}
