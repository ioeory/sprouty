import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './components/ThemeProvider'

/** Sync theme attributes before first paint to reduce flash. */
function syncThemeFromStorage() {
  const root = document.documentElement
  const mode = localStorage.getItem('sprouts_theme')
  if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode)
  else root.removeAttribute('data-theme')
  const pal = localStorage.getItem('sprouts_palette')
  if (pal === 'default') root.removeAttribute('data-palette')
  else root.setAttribute('data-palette', 'green')
}
syncThemeFromStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
