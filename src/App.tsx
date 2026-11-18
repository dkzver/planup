import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home'
import ErrorBoundary from './ErrorBoundary'

const EditorPage = lazy(() => import('./pages/EditorPage'))

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div style={{ padding: 40, color: '#5b6470' }}>Загрузка редактора…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
