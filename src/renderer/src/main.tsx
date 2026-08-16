import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import log from './logger'
import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Renderer root is missing.')

log.info('[renderer] Starting interface')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
