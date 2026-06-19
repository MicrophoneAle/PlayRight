import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import './index.css'
import App from './App.tsx'
import { practiceEngine } from './core/PracticeEngine.ts'
import { playbackEngine } from './core/PlaybackEngine.ts'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? ''

practiceEngine.ensureStoreSubscription()
playbackEngine.ensureStoreSubscription()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <App />
    </ClerkProvider>
  </StrictMode>,
)
