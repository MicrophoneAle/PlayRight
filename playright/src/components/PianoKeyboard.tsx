export function PianoKeyboard() {
  return (
    <section
      className="flex shrink-0 flex-col items-center justify-center border-t border-zinc-800 bg-zinc-900/60 px-6 py-8"
      aria-label="Virtual piano keyboard"
    >
      <div className="flex w-full max-w-5xl flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-700/80 bg-zinc-950/50 px-8 py-10">
        <div className="flex gap-1 opacity-40" aria-hidden>
          {Array.from({ length: 52 }, (_, index) => (
            <div
              key={`white-${index}`}
              className="h-16 w-3 rounded-sm bg-zinc-200"
            />
          ))}
        </div>
        <p className="text-center text-sm font-medium tracking-wide text-zinc-500">
          Virtual 88-Key Piano Component Placeholder
        </p>
        <p className="text-center text-xs text-zinc-600">
          Visual feedback strip — keys Q through \ map to the practice window
        </p>
      </div>
    </section>
  );
}
