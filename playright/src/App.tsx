import { useEffect, useRef } from 'react';
import { AudioEngine } from './core/AudioEngine.ts';
import { InputManager } from './core/InputManager.ts';
import { Dashboard } from './components/Dashboard.tsx';

function App() {
  const initializedRef = useRef(false);

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

  return <Dashboard />;
}

export default App;
