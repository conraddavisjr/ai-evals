import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { createHttpHarness, HarnessProvider } from './harness/index.js'
import './styles.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root missing')
createRoot(el).render(
  <StrictMode>
    <HarnessProvider client={createHttpHarness()}>
      <App />
    </HarnessProvider>
  </StrictMode>,
)
