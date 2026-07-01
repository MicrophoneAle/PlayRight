import { useEffect, useRef } from 'react';
import { AudioEngine } from './core/AudioEngine.ts';
import { InputManager } from './core/InputManager.ts';
import { fingeringProgramEngine } from './core/FingeringProgramEngine.ts';
import { handleEditModeFingerPress } from './core/fingeringEditMode.ts';
import { practiceEngine } from './core/PracticeEngine.ts';
import { playbackEngine } from './core/PlaybackEngine.ts';
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
    fingeringProgramEngine.attachAudioEngine(audioEngine);
    fingeringProgramEngine.ensureStoreSubscription();
    practiceEngine.attachAudioEngine(audioEngine);

    const routeFingerPress = (mapping: Parameters<NonNullable<typeof practiceEngine.handleFingerPress>>[0]) => {
      const { fingeringMode } = useEngineStore.getState();
      if (fingeringMode === 'program') {
        fingeringProgramEngine.handleFingerPress(mapping);
        return;
      }
      if (fingeringMode === 'edit') {
        handleEditModeFingerPress(mapping);
        return;
      }
      practiceEngine.handleFingerPress(mapping);
    };

    const routeFingerRelease = (mapping: Parameters<NonNullable<typeof practiceEngine.handleFingerRelease>>[0]) => {
      const { fingeringMode } = useEngineStore.getState();
      if (fingeringMode === 'program') {
        fingeringProgramEngine.handleFingerRelease(mapping);
        return;
      }
      practiceEngine.handleFingerRelease(mapping);
    };

    const inputManager = new InputManager(
      audioEngine,
      () => useEngineStore.getState().scopeStartMidi,
      {
        getScopeTranspose: () => useEngineStore.getState().scopeTranspose,
        onFingerPress: routeFingerPress,
        onFingerRelease: routeFingerRelease,
      },
    );
    playbackEngine.attachAudioEngine(audioEngine);

    const warmAudio = () => {
      void audioEngine.init();
    };

    window.addEventListener('pointerdown', warmAudio, { once: true, capture: true });
    window.addEventListener('keydown', warmAudio, { once: true, capture: true });

    return () => {
      window.removeEventListener('pointerdown', warmAudio, { capture: true });
      window.removeEventListener('keydown', warmAudio, { capture: true });
      inputManager.destroy();
      playbackEngine.dispose();
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
