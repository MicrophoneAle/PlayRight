import { Lid } from './Lid.tsx';
import { PianoKeyboard } from './PianoKeyboard.tsx';

export function Dashboard() {
  return (
    <div className="flex h-svh w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <Lid />
      <main className="flex min-h-0 flex-1 items-center justify-center px-6">
        <div className="text-center">
          <p className="text-sm font-medium text-zinc-500">
            Press Q through \ to trigger notes
          </p>
          <p className="mt-1 text-xs text-zinc-600">
            Audio engine logs appear in the browser console
          </p>
        </div>
      </main>
      <PianoKeyboard />
    </div>
  );
}
