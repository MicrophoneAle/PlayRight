/**
 * First-launch tutorial: page content, storage flag, and page-index math.
 * Rendering lives in `components/OnboardingTutorial.tsx`.
 */

import signInSignUpButtons from '../assets/PlayRight Sign-In and Sign-Up Buttons.png';
import importButton from '../assets/PlayRight Import Button.png';
import scoresButton from '../assets/PlayRight Scores Button.png';
import controls1 from '../assets/PlayRight Controls 1.png';
import controls2 from '../assets/PlayRight Controls 2.png';
import scoreViewAndStart from '../assets/PlayRight Score View and Start.png';

export const ONBOARDING_TUTORIAL_STORAGE_KEY = 'playright-onboarding-tutorial-seen';

/** Icon key resolved to a lucide component in OnboardingTutorial.tsx. */
export type OnboardingIconKey =
  | 'sign-in'
  | 'import'
  | 'open'
  | 'modes'
  | 'settings';

export interface OnboardingImage {
  /** Vite-imported asset URL. */
  src: string;
  alt: string;
}

export interface OnboardingPage {
  id: string;
  icon: OnboardingIconKey;
  eyebrow: string;
  title: string;
  body: string;
  /** Primary screenshot; `null` renders the labeled placeholder frame. */
  image: OnboardingImage | null;
  /**
   * Optional second screenshot. When set (with `image`), the artwork region
   * lays both out side-by-side — reusable for any future dual-image page.
   */
  image2?: OnboardingImage | null;
}

export const ONBOARDING_PAGES: readonly OnboardingPage[] = [
  {
    id: 'signing-in',
    icon: 'sign-in',
    eyebrow: 'Your account',
    title: 'Signing in',
    body:
      'Click the Sign-In or Sign-Up button to register and save scores in your account with Clerk authentication. A limited number of scores are available when not signed in.',
    image: {
      src: signInSignUpButtons,
      alt: 'PlayRight Sign-In and Sign-Up Buttons',
    },
  },
  {
    id: 'importing-scores',
    icon: 'import',
    eyebrow: 'Your library',
    title: 'Import',
    body: 'Select a MusicXML or MXL file to upload to the scores list.',
    image: {
      src: importButton,
      alt: 'PlayRight Import Button',
    },
  },
  {
    id: 'opening-scores',
    icon: 'open',
    eyebrow: 'Your library',
    title: 'Score Selection',
    body:
      'Open the scores menu using the scores button and navigate through to select one of your saved scores.',
    image: {
      src: scoresButton,
      alt: 'PlayRight Scores Button',
    },
  },
  {
    id: 'changing-modes',
    icon: 'modes',
    eyebrow: 'How you practice',
    title: 'Modify Controls',
    body:
      'Switch between one-handed and two-handed mode, program fingerings into your scores, modify key bindings, and more.',
    image: {
      src: controls1,
      alt: 'PlayRight Controls 1',
    },
    image2: {
      src: controls2,
      alt: 'PlayRight Controls 2',
    },
  },
  {
    id: 'settings-and-shortcuts',
    icon: 'settings',
    eyebrow: 'Playthrough',
    title: 'Plug and Play',
    body:
      'Hit the play button to start your piece and control the playthrough with pause and restart.',
    image: {
      src: scoreViewAndStart,
      alt: 'PlayRight Score View and Start',
    },
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
