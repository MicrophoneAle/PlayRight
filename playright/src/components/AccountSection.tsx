import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
  useUser,
} from '@clerk/react';
import { LogIn, UserRound } from 'lucide-react';

const signInButtonClass =
  'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 sm:text-sm';

const signUpButtonClass =
  'inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500 sm:text-sm';

export function AccountSection() {
  const { isLoaded } = useAuth();
  const { user } = useUser();

  if (!isLoaded) {
    return (
      <div
        className="flex h-10 min-w-[7.5rem] items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3"
        aria-label="Loading account"
      >
        <div className="h-6 w-6 animate-pulse rounded-full bg-zinc-800" />
        <div className="hidden h-3 w-16 animate-pulse rounded bg-zinc-800 sm:block" />
      </div>
    );
  }

  const displayName =
    user?.fullName ??
    user?.firstName ??
    user?.primaryEmailAddress?.emailAddress ??
    'Account';

  return (
    <section
      className="flex shrink-0 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 sm:px-3"
      aria-label="Account"
    >
      <UserRound
        size={15}
        strokeWidth={2}
        className="shrink-0 text-zinc-500"
        aria-hidden
      />
      <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-zinc-600 lg:inline">
        Account
      </span>

      <Show when="signed-out">
        <div className="flex items-center gap-1">
          <SignInButton mode="modal">
            <button type="button" className={signInButtonClass}>
              <LogIn size={14} strokeWidth={2} aria-hidden />
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button type="button" className={signUpButtonClass}>
              Sign up
            </button>
          </SignUpButton>
        </div>
      </Show>

      <Show when="signed-in">
        <div className="flex items-center gap-2">
          <span className="max-w-[8rem] truncate text-xs font-medium text-zinc-300 sm:max-w-[10rem] sm:text-sm">
            {displayName}
          </span>
          <UserButton
            appearance={{
              elements: {
                avatarBox: 'h-8 w-8 ring-2 ring-violet-500/40',
              },
            }}
          />
        </div>
      </Show>
    </section>
  );
}
