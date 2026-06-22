import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronDown, ChevronUp, Brain } from 'lucide-react'
import { api, type ReviewPlanItem, type Card } from '../lib/api'

export default function Plan() {
  const [plan, setPlan] = useState<ReviewPlanItem[]>([])
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    api
      .get<ReviewPlanItem[]>(`/study/plan?days=${days}`)
      .then((data) => {
        setPlan(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load review plan')
        setLoading(false)
      })
  }, [days])

  const total = useMemo(() => plan.reduce((sum, item) => sum + item.count, 0), [plan])
  const maxCount = useMemo(() => Math.max(...plan.map((item) => item.count), 1), [plan])

  function toggleDate(date: string) {
    const next = new Set(expandedDates)
    if (next.has(date)) {
      next.delete(date)
    } else {
      next.add(date)
    }
    setExpandedDates(next)
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const diff = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    let label = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    if (diff === 0) label += ' · Today'
    else if (diff === 1) label += ' · Tomorrow'
    else label += ` · In ${diff} days`
    return label
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Loading…</div>
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="w-7 h-7 text-indigo-600" />
          <h1 className="text-2xl font-semibold">Review Plan</h1>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600">Next</label>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-white"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-sm text-slate-500">Total upcoming reviews</p>
            <p className="text-3xl font-semibold text-slate-800">{total}</p>
          </div>
          <Link
            to="/study"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Brain className="w-4 h-4" /> Start Studying
          </Link>
        </div>

        {plan.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            No upcoming reviews in the next {days} days.
          </div>
        ) : (
          <div className="space-y-3">
            {plan.map((item) => {
              const expanded = expandedDates.has(item.date)
              const widthPercent = (item.count / maxCount) * 100
              return (
                <div
                  key={item.date}
                  className="border border-slate-200 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => toggleDate(item.date)}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <span className="font-medium text-slate-800 w-40 text-left">
                        {formatDate(item.date)}
                      </span>
                      <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${widthPercent}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-slate-600 w-16 text-right">
                        {item.count}
                      </span>
                    </div>
                    {expanded ? (
                      <ChevronUp className="w-4 h-4 text-slate-400 ml-3" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400 ml-3" />
                    )}
                  </button>

                  {expanded && (
                    <div className="border-t border-slate-100 bg-slate-50 p-4">
                      <ul className="space-y-2">
                        {item.cards.map((card: Card) => (
                          <li
                            key={card.id}
                            className="flex items-center justify-between bg-white rounded-lg border border-slate-200 p-3"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">
                                {card.front.replace(/!\[.*?\]\(.*?\)/g, '[image]').replace(/[#*_`]/g, '')}
                              </p>
                              <p className="text-xs text-slate-500">
                                {card.state} · Deck {card.deck_id.slice(0, 8)}
                              </p>
                            </div>
                            <Link
                              to={`/cards/${card.id}/edit`}
                              className="text-xs text-indigo-600 hover:underline ml-3 flex-shrink-0"
                            >
                              Edit
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
