import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css' // Crucial for Tailwind v4 imports

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)