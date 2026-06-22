import { useEffect, useState } from 'react'
import { BarChart3, BookOpen, CalendarCheck, Clock, Sparkles } from 'lucide-react'
import { api, type Stats as StatsData } from '../lib/api'

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm font-medium text-slate-600">{label}</span>
      </div>
      <p className="text-3xl font-semibold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  )
}

export default function Stats() {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<StatsData>('/stats')
      .then((data) => {
        setStats(data)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load stats')
        setLoading(false)
      })
  }, [])

  if (loading) return <div className="text-center py-12 text-slate-500">Loading…</div>
  if (error) return <div className="text-center py-12 text-red-600">{error}</div>
  if (!stats) return null

  const retentionPct = Math.round(stats.retention * 100)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-7 h-7 text-indigo-600" />
        <h1 className="text-2xl font-semibold">Statistics</h1>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={BookOpen} label="Total Cards" value={stats.total_cards.toString()} />
        <StatCard
          icon={Clock}
          label="Due Today"
          value={stats.due_today.toString()}
          sub="Cards ready for review"
        />
        <StatCard
          icon={CalendarCheck}
          label="Reviewed Today"
          value={stats.reviewed_today.toString()}
          sub="Unique cards reviewed"
        />
        <StatCard
          icon={Sparkles}
          label="New Cards"
          value={stats.new_cards.toString()}
          sub="Not yet studied"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Estimated Retention</h2>
        <div className="flex items-center gap-4">
          <div className="relative w-24 h-24">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-slate-100"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="text-indigo-600"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeDasharray={`${retentionPct}, 100`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-semibold">{retentionPct}%</span>
            </div>
          </div>
          <p className="text-slate-600 text-sm max-w-md">
            This is a rough estimate based on your reviewed cards. Higher retention means you are
            remembering more of what you have studied.
          </p>
        </div>
      </div>
    </div>
  )
}
