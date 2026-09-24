import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { DrawerProvider } from './components/Drawer.js'
import { createHttpHarness, HarnessProvider } from './harness/index.js'
import './charts/charts.css'
import './styles.css'
import './themes/refined.css'
import { applyTheme, readTheme } from './themes/theme.js'

const el = document.getElementById('root')
if (!el) throw new Error('#root missing')
// before the first paint, so the page never flashes the other theme
applyTheme(readTheme())

createRoot(el).render(
  <StrictMode>
    <HarnessProvider client={createHttpHarness()}>
      <DrawerProvider>
        <App />
      </DrawerProvider>
    </HarnessProvider>
  </StrictMode>,
)
