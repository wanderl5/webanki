import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { Brain, Library, PlusCircle, BarChart3, CalendarDays, Upload, LogOut } from 'lucide-react'
import { clearToken, getToken } from '../lib/api'

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const token = getToken()
  const isAuthed = Boolean(token)

  function handleLogout() {
    clearToken()
    navigate('/login')
  }

  const navItems = [
    { to: '/decks', icon: Library, label: 'Decks' },
    { to: '/study', icon: Brain, label: 'Study' },
    { to: '/cards/new', icon: PlusCircle, label: 'New Card' },
    { to: '/import', icon: Upload, label: 'Import' },
    { to: '/stats', icon: BarChart3, label: 'Stats' },
    { to: '/plan', icon: CalendarDays, label: 'Plan' },
  ]

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/decks" className="flex items-center gap-2 font-semibold text-indigo-600">
            <Brain className="w-6 h-6" />
            <span>WebAnki</span>
          </Link>

          {isAuthed && (
            <nav className="flex items-center gap-1 sm:gap-4">
              {navItems.map(({ to, icon: Icon, label }) => (
                <Link
                  key={to}
                  to={to}
                  className={`flex items-center gap-1 px-2 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    location.pathname.startsWith(to)
                      ? 'text-indigo-600 bg-indigo-50'
                      : 'text-slate-600 hover:text-indigo-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              ))}
              <button
                onClick={handleLogout}
                className="flex items-center gap-1 px-2 py-1.5 text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </nav>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
        <Outlet />
      </main>

      <footer className="text-center text-xs text-slate-400 py-4">
        WebAnki — spaced repetition in the browser
      </footer>
    </div>
  )
}
