import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { DrawerProvider } from './components/Drawer.js'
import { createHttpHarness, HarnessProvider } from './harness/index.js'
import './charts/charts.css'
import './styles.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root missing')
createRoot(el).render(
  <StrictMode>
    <HarnessProvider client={createHttpHarness()}>
      <DrawerProvider>
        <App />
      </DrawerProvider>
    </HarnessProvider>
  </StrictMode>,
)
