import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
} from '@clerk/react';

const toolbarButtonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100 sm:px-3.5';

export function AccountSection() {
  const { isLoaded } = useAuth();

  if (!isLoaded) {
    return (
      <div
        className="h-[2.375rem] w-[2.375rem] shrink-0 animate-pulse rounded-lg bg-zinc-800"
        aria-label="Loading account"
      />
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button type="button" className={toolbarButtonClass}>
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button
            type="button"
            className="hidden items-center justify-center gap-2 rounded-lg bg-violet-600 px-2.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 sm:inline-flex sm:px-3.5"
          >
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton
          appearance={{
            elements: {
              avatarBox: 'h-9 w-9',
            },
          }}
        />
      </Show>
    </div>
  );
}
