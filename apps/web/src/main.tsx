import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import { Layout } from './Layout.tsx'
import { Dashboard } from './pages/Dashboard.tsx'
import { Scan } from './pages/Scan.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/scan/:id" element={<Scan />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
