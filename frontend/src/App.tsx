import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Decks from './pages/Decks'
import DeckDetail from './pages/DeckDetail'
import CardNew from './pages/CardNew'
import CardEdit from './pages/CardEdit'
import CardView from './pages/CardView'
import Study from './pages/Study'
import Stats from './pages/Stats'
import Plan from './pages/Plan'
import Import from './pages/Import'
import { getToken } from './lib/api'

function RequireAuth({ children }: { children: React.ReactNode }) {
  return getToken() ? children : <Navigate to="/login" replace />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/decks" replace />} />
        <Route path="decks" element={<Decks />} />
        <Route path="decks/:id" element={<DeckDetail />} />
        <Route path="cards/new" element={<CardNew />} />
        <Route path="cards/:id" element={<CardView />} />
        <Route path="cards/:id/edit" element={<CardEdit />} />
        <Route path="study" element={<Study />} />
        <Route path="stats" element={<Stats />} />
        <Route path="plan" element={<Plan />} />
        <Route path="import" element={<Import />} />
      </Route>
      <Route path="*" element={<Navigate to="/decks" replace />} />
    </Routes>
  )
}

export default App
