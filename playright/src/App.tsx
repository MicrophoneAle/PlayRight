import { useEffect, useRef } from 'react';
import { AudioEngine } from './core/AudioEngine.ts';
import { InputManager } from './core/InputManager.ts';
import { practiceEngine } from './core/PracticeEngine.ts';
import { usePracticeKeyboardShortcuts } from './core/usePracticeKeyboardShortcuts.ts';
import { Dashboard } from './components/Dashboard.tsx';
import { SupabaseClerkBridge } from './components/SupabaseClerkBridge.tsx';
import { useEngineStore } from './store/useEngineStore.ts';

function App() {
  const initializedRef = useRef(false);
  usePracticeKeyboardShortcuts();

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;

    const audioEngine = new AudioEngine();
    const inputManager = new InputManager(
      audioEngine,
      () => useEngineStore.getState().scopeStartMidi,
      {
        getScopeTranspose: () => useEngineStore.getState().scopeTranspose,
        onFingerPress: (mapping) => practiceEngine.handleFingerPress(mapping),
      },
    );

    const warmAudio = () => {
      void audioEngine.init();
    };

    window.addEventListener('pointerdown', warmAudio, { once: true, capture: true });
    window.addEventListener('keydown', warmAudio, { once: true, capture: true });

    return () => {
      window.removeEventListener('pointerdown', warmAudio, { capture: true });
      window.removeEventListener('keydown', warmAudio, { capture: true });
      inputManager.destroy();
      audioEngine.destroy();
    };
  }, []);

  return (
    <>
      <SupabaseClerkBridge />
      <Dashboard />
    </>
  );
}

export default App;
