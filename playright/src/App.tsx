import { useEffect, useRef, useState } from 'react';
import { AudioEngine } from './core/AudioEngine.ts';
import { InputManager } from './core/InputManager.ts';
import { Dashboard } from './components/Dashboard.tsx';
import type { PlaybackScript } from './types/index.ts';

function App() {
  const initializedRef = useRef(false);
  const [playbackScript, setPlaybackScript] = useState<PlaybackScript | null>(
    null,
  );

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;

    const audioEngine = new AudioEngine();
    const inputManager = new InputManager(audioEngine);

    return () => {
      inputManager.destroy();
      audioEngine.destroy();
    };
  }, []);

  const handleScriptLoaded = (script: PlaybackScript) => {
    setPlaybackScript(script);
    console.log(
      `[PlayRight] PlaybackScript loaded (${script.length} steps)`,
      script,
    );
  };

  return (
    <Dashboard
      onScriptLoaded={handleScriptLoaded}
      playbackScript={playbackScript}
    />
  );
}

export default App;
