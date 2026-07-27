import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ONBOARDING_PAGES,
  ONBOARDING_PAGE_COUNT,
  ONBOARDING_TUTORIAL_STORAGE_KEY,
  clampOnboardingPage,
  hasSeenOnboardingTutorial,
  isFirstOnboardingPage,
  isLastOnboardingPage,
  markOnboardingTutorialSeen,
  nextOnboardingPage,
  previousOnboardingPage,
  resetOnboardingTutorial,
} from './onboardingTutorial.ts';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('onboarding tutorial pages', () => {
  it('walks the five briefed topics in order', () => {
    expect(ONBOARDING_PAGE_COUNT).toBe(5);
    expect(ONBOARDING_PAGES.map((page) => page.id)).toEqual([
      'signing-in',
      'importing-scores',
      'opening-scores',
      'changing-modes',
      'settings-and-shortcuts',
    ]);
  });

  it('gives every page unique keys and non-empty copy slots', () => {
    const ids = new Set(ONBOARDING_PAGES.map((page) => page.id));
    expect(ids.size).toBe(ONBOARDING_PAGE_COUNT);

    for (const page of ONBOARDING_PAGES) {
      expect(page.title.length).toBeGreaterThan(0);
      expect(page.eyebrow.length).toBeGreaterThan(0);
      expect(page.body.length).toBeGreaterThan(0);
    }
  });

  it('ships final screenshots for every page (dual images use image2)', () => {
    for (const page of ONBOARDING_PAGES) {
      expect(page.image).not.toBeNull();
      expect(page.image?.src.length).toBeGreaterThan(0);
      expect(page.image?.alt.length).toBeGreaterThan(0);
    }

    const dual = ONBOARDING_PAGES.find((page) => page.image2);
    expect(dual?.id).toBe('changing-modes');
    expect(dual?.image2?.src.length).toBeGreaterThan(0);
    expect(dual?.image2?.alt).toBe('PlayRight Controls 2');
  });
});

describe('onboarding page navigation', () => {
  it('clamps out-of-range and non-finite indexes', () => {
    expect(clampOnboardingPage(-3)).toBe(0);
    expect(clampOnboardingPage(99)).toBe(ONBOARDING_PAGE_COUNT - 1);
    expect(clampOnboardingPage(Number.NaN)).toBe(0);
    expect(clampOnboardingPage(2.7)).toBe(2);
  });

  it('stops at both ends instead of wrapping', () => {
    expect(previousOnboardingPage(0)).toBe(0);
    expect(nextOnboardingPage(ONBOARDING_PAGE_COUNT - 1)).toBe(
      ONBOARDING_PAGE_COUNT - 1,
    );
    expect(nextOnboardingPage(0)).toBe(1);
    expect(previousOnboardingPage(3)).toBe(2);
  });

  it('reports the edge pages so the arrows can disable and swap', () => {
    expect(isFirstOnboardingPage(0)).toBe(true);
    expect(isFirstOnboardingPage(1)).toBe(false);
    expect(isLastOnboardingPage(ONBOARDING_PAGE_COUNT - 1)).toBe(true);
    expect(isLastOnboardingPage(0)).toBe(false);
  });
});

describe('first-launch flag', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      localStorage: createMemoryStorage(),
    };
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it('treats a fresh browser as first launch', () => {
    expect(hasSeenOnboardingTutorial()).toBe(false);
  });

  it('stores a timestamp on dismissal and stays dismissed', () => {
    markOnboardingTutorialSeen(new Date('2026-07-27T10:00:00.000Z'));

    expect(hasSeenOnboardingTutorial()).toBe(true);
    expect(
      window.localStorage.getItem(ONBOARDING_TUTORIAL_STORAGE_KEY),
    ).toBe('2026-07-27T10:00:00.000Z');
  });

  it('auto-shows again after the key is cleared', () => {
    markOnboardingTutorialSeen();
    resetOnboardingTutorial();

    expect(hasSeenOnboardingTutorial()).toBe(false);
  });

  it('degrades to showing the tutorial when storage throws', () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage(): Storage {
        throw new Error('storage blocked');
      },
    };

    expect(hasSeenOnboardingTutorial()).toBe(false);
    expect(() => markOnboardingTutorialSeen()).not.toThrow();
  });
});
