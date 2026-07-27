import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  Hand,
  Keyboard,
  Library,
  LogIn,
  Upload,
  X,
} from 'lucide-react';
import {
  ONBOARDING_PAGES,
  ONBOARDING_PAGE_COUNT,
  clampOnboardingPage,
  hasSeenOnboardingTutorial,
  isFirstOnboardingPage,
  isLastOnboardingPage,
  markOnboardingTutorialSeen,
  nextOnboardingPage,
  previousOnboardingPage,
  type OnboardingIconKey,
  type OnboardingImage,
  type OnboardingPage,
} from '../core/onboardingTutorial.ts';
import { useEngineStore } from '../store/useEngineStore.ts';

const PAGE_ICONS: Record<OnboardingIconKey, typeof LogIn> = {
  'sign-in': LogIn,
  import: Upload,
  open: Library,
  modes: Hand,
  settings: Keyboard,
};

/** Pixel-identical outer dialog bounds on every page. */
const TUTORIAL_PANEL_WIDTH_PX = 544;
const TUTORIAL_PANEL_HEIGHT_PX = 568;

/** Diagonal hatch marks the frame as awaiting a real screenshot. */
const PLACEHOLDER_HATCH =
  'repeating-linear-gradient(135deg, rgba(139,92,246,0.05) 0 10px, transparent 10px 20px)';

function ArtworkImage({ image }: { image: OnboardingImage }) {
  return (
    <img
      src={image.src}
      alt={image.alt}
      className="max-h-full max-w-full object-contain"
      draggable={false}
    />
  );
}

function PageArtwork({ page }: { page: OnboardingPage }) {
  const Icon = PAGE_ICONS[page.icon];
  const images = page.images;

  if (images.length > 1) {
    // Equal-width vertical stack; region scrolls when the stack exceeds h-60.
    return (
      <div
        data-testid="onboarding-artwork-stack"
        className="flex h-full w-full flex-col items-stretch gap-2 overflow-y-auto overscroll-contain"
      >
        {images.map((image) => (
          <img
            key={image.alt}
            src={image.src}
            alt={image.alt}
            className="w-full shrink-0 object-contain"
            draggable={false}
          />
        ))}
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ArtworkImage image={images[0]} />
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60"
      style={{ backgroundImage: PLACEHOLDER_HATCH }}
      role="img"
      aria-label={`Screenshot placeholder for ${page.title}`}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600/15 text-violet-400">
        <Icon size={18} strokeWidth={1.75} aria-hidden />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-zinc-300">{page.title}</p>
        <p className="mt-0.5 text-xs text-zinc-600">Screenshot goes here</p>
      </div>
    </div>
  );
}

export function OnboardingTutorial() {
  const isOpen = useEngineStore((state) => state.tutorialOpen);
  const setTutorialOpen = useEngineStore((state) => state.actions.setTutorialOpen);
  const [pageIndex, setPageIndex] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const panelRef = useRef<HTMLDivElement>(null);
  const autoOpenCheckedRef = useRef(false);

  useEffect(() => {
    if (autoOpenCheckedRef.current) {
      return;
    }

    autoOpenCheckedRef.current = true;

    if (!hasSeenOnboardingTutorial()) {
      setTutorialOpen(true);
    }
  }, [setTutorialOpen]);

  const close = useCallback(() => {
    markOnboardingTutorialSeen();
    setTutorialOpen(false);
    setPageIndex(0);
    setDirection('forward');
  }, [setTutorialOpen]);

  const goTo = useCallback(
    (index: number) => {
      const target = clampOnboardingPage(index);
      if (target === pageIndex) {
        return;
      }

      setDirection(target > pageIndex ? 'forward' : 'back');
      setPageIndex(target);
    },
    [pageIndex],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    // Capture phase + stopPropagation: arrow keys drive the tutorial only, and
    // never reach the scope-shift / practice handlers underneath.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        goTo(nextOnboardingPage(pageIndex));
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        goTo(previousOnboardingPage(pageIndex));
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [close, goTo, isOpen, pageIndex]);

  useEffect(() => {
    if (isOpen) {
      panelRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const page = ONBOARDING_PAGES[pageIndex];
  const onFirstPage = isFirstOnboardingPage(pageIndex);
  const onLastPage = isLastOnboardingPage(pageIndex);

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto bg-black/70 p-4"
      onClick={close}
      role="presentation"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="onboarding-tutorial-panel"
        className="my-auto flex shrink-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl outline-none"
        style={{
          width: TUTORIAL_PANEL_WIDTH_PX,
          height: TUTORIAL_PANEL_HEIGHT_PX,
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <h2
            id="onboarding-title"
            className="min-w-0 truncate text-sm font-semibold text-zinc-100"
          >
            Getting started
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close tutorial"
            className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div
          key={page.id}
          className={`playright-tutorial-page playright-tutorial-page-${direction} flex min-h-0 flex-1 flex-col gap-2 px-4 pt-3 pb-4`}
        >
          {/* Fixed image region: single or dual layouts never change outer size. */}
          <div className="flex h-60 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1.5">
            <PageArtwork page={page} />
          </div>

          <div className="flex min-h-[5.75rem] flex-1 flex-col justify-start pt-1">
            <p
              className="text-[11px] font-medium uppercase tracking-[0.14em] text-violet-400"
            >
              {page.eyebrow}
            </p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight text-zinc-100">
              {page.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
              {page.body}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            onClick={() => goTo(pageIndex - 1)}
            disabled={onFirstPage}
            aria-label="Previous page"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-zinc-700 disabled:hover:bg-zinc-900 disabled:hover:text-zinc-300"
          >
            <ChevronLeft size={15} strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">Back</span>
          </button>

          {/* Signature: the app's own keybed as the page indicator. */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="flex items-start gap-[2px]" role="group" aria-label="Tutorial pages">
              {ONBOARDING_PAGES.map((indicatorPage, index) => {
                const isCurrent = index === pageIndex;
                const isPassed = index < pageIndex;

                return (
                  <button
                    key={indicatorPage.id}
                    type="button"
                    aria-current={isCurrent ? 'step' : undefined}
                    aria-label={`Page ${index + 1}: ${indicatorPage.title}`}
                    onClick={() => goTo(index)}
                    className={`h-7 w-3.5 rounded-b-[3px] border shadow-[inset_0_-7px_9px_-7px_rgba(0,0,0,0.55)] transition-all duration-150 ${
                      isCurrent
                        ? 'translate-y-[2px] border-violet-400 bg-violet-500 shadow-[0_0_14px_rgba(139,92,246,0.5)]'
                        : isPassed
                          ? 'border-zinc-600 bg-zinc-500 hover:bg-zinc-400'
                          : 'border-zinc-400 bg-zinc-200 hover:bg-white'
                    }`}
                  />
                );
              })}
            </div>
            <p className="text-[11px] tabular-nums text-zinc-500">
              {pageIndex + 1} of {ONBOARDING_PAGE_COUNT}
            </p>
          </div>

          {onLastPage ? (
            <button
              type="button"
              onClick={close}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
            >
              Start playing
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(pageIndex + 1)}
              aria-label="Next page"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight size={15} strokeWidth={2} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
