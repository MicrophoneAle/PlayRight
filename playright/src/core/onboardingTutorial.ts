/**
 * First-launch tutorial: page content, storage flag, and page-index math.
 * Rendering lives in `components/OnboardingTutorial.tsx`.
 */

export const ONBOARDING_TUTORIAL_STORAGE_KEY = 'playright-onboarding-tutorial-seen';

/** Icon key resolved to a lucide component in OnboardingTutorial.tsx. */
export type OnboardingIconKey =
  | 'sign-in'
  | 'import'
  | 'open'
  | 'modes'
  | 'settings';

export interface OnboardingImage {
  /** Imported asset or `/public` path. */
  src: string;
  alt: string;
}

export interface OnboardingPage {
  id: string;
  icon: OnboardingIconKey;
  eyebrow: string;
  title: string;
  /** PLACEHOLDER COPY — replace with final wording. */
  body: string;
  /** `null` renders the labeled placeholder frame instead of a screenshot. */
  image: OnboardingImage | null;
}

/**
 * Swap in real screenshots by setting `image` on a page:
 *   image: { src: signInShot, alt: 'The header with the sign-in button' }
 * Nothing else changes — the frame keeps its size and the placeholder drops out.
 */
export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
  {
    id: 'signing-in',
    icon: 'sign-in',
    eyebrow: 'Your account',
    title: 'Signing in',
    body:
      'PLACEHOLDER COPY — replace before launch. Two or three sentences on where the sign-in control lives, what an account unlocks (saved scores and fingerings that follow you between devices), and what still works while signed out.',
    image: null,
  },
  {
    id: 'importing-scores',
    icon: 'import',
    eyebrow: 'Your library',
    title: 'Importing scores',
    body:
      'PLACEHOLDER COPY — replace before launch. Two or three sentences on Import: which file types load (MusicXML and MXL), where the file picker appears, and that an imported piece is saved to the library automatically.',
    image: null,
  },
  {
    id: 'opening-scores',
    icon: 'open',
    eyebrow: 'Your library',
    title: 'Opening scores',
    body:
      'PLACEHOLDER COPY — replace before launch. Two or three sentences on the Scores panel: how to reopen a saved piece, how sorting and search help once the library grows, and that C opens the panel from anywhere.',
    image: null,
  },
  {
    id: 'changing-modes',
    icon: 'modes',
    eyebrow: 'How you practice',
    title: 'Changing modes',
    body:
      'PLACEHOLDER COPY — replace before launch. Three or four sentences distinguishing one-hand practice (a movable scope, one staff at a time), two-hand practice (finger keys for both hands), and play mode (the piece plays itself so you can listen along).',
    image: null,
  },
  {
    id: 'settings-and-shortcuts',
    icon: 'settings',
    eyebrow: 'Everything else',
    title: 'Settings and shortcuts',
    body:
      'PLACEHOLDER COPY — replace before launch. Two or three sentences on the gear menu (tempo, auto-fingering, hand size, scroll behaviour) and the shortcuts panel, plus the handful of keys worth learning first: Enter, Space, X, Z, C.',
    image: null,
  },
];

export const ONBOARDING_PAGE_COUNT = ONBOARDING_PAGES.length;

function readStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True once the tutorial has been closed at least once, on any page. */
export function hasSeenOnboardingTutorial(): boolean {
  try {
    return Boolean(readStorage()?.getItem(ONBOARDING_TUTORIAL_STORAGE_KEY));
  } catch {
    return false;
  }
}

/** Stores an ISO timestamp so the value doubles as "when did they first see it". */
export function markOnboardingTutorialSeen(seenAt: Date = new Date()): void {
  try {
    readStorage()?.setItem(
      ONBOARDING_TUTORIAL_STORAGE_KEY,
      seenAt.toISOString(),
    );
  } catch {
    // Storage is unavailable (private mode, blocked cookies) — the tutorial
    // simply shows again next launch.
  }
}

/** Clears the flag so the next launch auto-shows the tutorial again. */
export function resetOnboardingTutorial(): void {
  try {
    readStorage()?.removeItem(ONBOARDING_TUTORIAL_STORAGE_KEY);
  } catch {
    // Ignore — nothing to clear.
  }
}

export function clampOnboardingPage(index: number): number {
  if (!Number.isFinite(index)) {
    return 0;
  }

  return Math.min(ONBOARDING_PAGE_COUNT - 1, Math.max(0, Math.trunc(index)));
}

export function isFirstOnboardingPage(index: number): boolean {
  return clampOnboardingPage(index) === 0;
}

export function isLastOnboardingPage(index: number): boolean {
  return clampOnboardingPage(index) === ONBOARDING_PAGE_COUNT - 1;
}

/** Stops at the last page — advancing past the end is the Done button's job. */
export function nextOnboardingPage(index: number): number {
  return clampOnboardingPage(clampOnboardingPage(index) + 1);
}

export function previousOnboardingPage(index: number): number {
  return clampOnboardingPage(clampOnboardingPage(index) - 1);
}
