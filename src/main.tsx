import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import SharedFolderView from './components/SharedFolderView'
import { registerServiceWorker } from './sw-register'

// Register service worker for background reminders + offline support
registerServiceWorker();

// Public, auth-free route: /shared/:token renders a standalone read-only view.
const sharedMatch = window.location.pathname.match(/^\/shared\/([^/]+)\/?$/);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {sharedMatch
      ? <SharedFolderView token={decodeURIComponent(sharedMatch[1])} />
      : <App />}
  </StrictMode>,
)
