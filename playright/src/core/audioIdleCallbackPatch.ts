/**
 * Must load before any Tone.js audio. Tone's OneShotSource disposes finished
 * voices via requestIdleCallback without a timeout; under sustained play-mode
 * load those callbacks can starve and leak Gain nodes into the WebAudio graph.
 * See AudioEngine.ts for full rationale.
 */
if (
  typeof window !== 'undefined' &&
  typeof window.requestIdleCallback === 'function'
) {
  const nativeRequestIdleCallback = window.requestIdleCallback.bind(window);
  window.requestIdleCallback = (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) =>
    nativeRequestIdleCallback(callback, {
      ...options,
      timeout: options?.timeout ?? 100,
    });
}
