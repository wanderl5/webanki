import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Eye, CheckCircle2 } from 'lucide-react'
import { api, type StudyQueueItem, type ReviewResponse } from '../lib/api'
import MarkdownRenderer from '../components/MarkdownRenderer'
import MediaRenderer from '../components/MediaRenderer'

type Rating = 'Again' | 'Hard' | 'Good' | 'Easy'

const ratingConfig: Record<
  Rating,
  { label: string; color: string }
> = {
  Again: { label: 'Again', color: 'bg-red-600 hover:bg-red-700' },
  Hard: { label: 'Hard', color: 'bg-orange-500 hover:bg-orange-600' },
  Good: { label: 'Good', color: 'bg-blue-600 hover:bg-blue-700' },
  Easy: { label: 'Easy', color: 'bg-emerald-600 hover:bg-emerald-700' },
}

export default function Study() {
  const [searchParams] = useSearchParams()
  const deckId = searchParams.get('deckId')
  const includeSubdecks = searchParams.get('include_subdecks') !== 'false'
  const managed = searchParams.getAll('managed')
  const state = searchParams.getAll('state')
  const mastery = searchParams.getAll('mastery')
  const search = searchParams.get('search') || ''

  const [queue, setQueue] = useState<StudyQueueItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showBack, setShowBack] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState(false)
  const [lastInterval, setLastInterval] = useState<number | null>(null)

  async function fetchQueue() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (deckId) {
        params.set('deck_id', deckId)
        params.set('include_subdecks', String(includeSubdecks))
      }
      if (managed.length) params.set('managed', managed.join(','))
      if (state.length) params.set('state', state.join(','))
      if (mastery.length) params.set('mastery', mastery.join(','))
      if (search.trim()) params.set('search', search.trim())
      const query = params.toString() ? `?${params.toString()}` : ''
      const data = await api.get<StudyQueueItem[]>(`/study/queue${query}`)
      setQueue(data)
      setCurrentIndex(0)
      setShowBack(false)
      setCompleted(data.length === 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load study queue')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchQueue()
  }, [deckId, includeSubdecks, managed.join(','), state.join(','), mastery.join(','), search])

  async function handleRate(rating: Rating) {
    const card = queue[currentIndex]
    if (!card) return
    try {
      const res = await api.post<ReviewResponse>(`/study/${card.id}/review`, { rating })
      setLastInterval(res.interval_days)
      setShowBack(false)
      if (currentIndex + 1 >= queue.length) {
        setCompleted(true)
      } else {
        setCurrentIndex((i) => i + 1)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review')
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Loading…</div>

  if (completed) {
    const noMatchingCards = queue.length === 0
    return (
      <div className="max-w-xl mx-auto text-center py-16 bg-white rounded-xl border border-slate-200">
        <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
        <h2 className="text-2xl font-semibold mb-2">
          {noMatchingCards ? 'No cards to study' : 'All caught up!'}
        </h2>
        <p className="text-slate-600 mb-6">
          {noMatchingCards
            ? 'No cards match the current study scope or filters.'
            : lastInterval !== null
              ? `Next review scheduled in ${lastInterval} day${lastInterval === 1 ? '' : 's'}.`
              : 'No cards due for review right now.'}
        </p>
        <Link
          to={deckId ? `/decks/${deckId}` : '/decks'}
          className="inline-flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to decks
        </Link>
      </div>
    )
  }

  const card = queue[currentIndex]
  if (!card) return <div className="text-center py-12 text-slate-500">No cards available.</div>

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <Link
          to={deckId ? `/decks/${deckId}` : '/decks'}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <span className="text-sm text-slate-500">
          Card {currentIndex + 1} of {queue.length}
        </span>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 min-h-[260px] flex flex-col">
        <div className="flex-1 p-8 flex items-center justify-center">
          <div className="text-center w-full">
            <p className="text-sm text-slate-400 mb-4 uppercase tracking-wide">Front</p>
            <div className="text-left">
              <MarkdownRenderer text={card.front} className="sm:prose-base prose-p:my-2" />
            </div>
            <MediaRenderer media={card.media} />
          </div>
        </div>

        {showBack && (
          <div className="border-t border-slate-100 p-8 flex items-center justify-center">
            <div className="text-center w-full">
              <p className="text-sm text-slate-400 mb-4 uppercase tracking-wide">Back</p>
              <div className="text-left">
                <MarkdownRenderer text={card.back} className="sm:prose-base prose-p:my-2" />
              </div>
              <MediaRenderer media={card.media} />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6">
        {!showBack ? (
          <button
            onClick={() => setShowBack(true)}
            className="w-full py-4 sm:py-3 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2 text-base sm:text-sm"
          >
            <Eye className="w-5 h-5" /> Show Answer
          </button>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {(Object.keys(ratingConfig) as Rating[]).map((rating) => (
              <button
                key={rating}
                onClick={() => handleRate(rating)}
                className={`py-4 sm:py-3 text-white font-medium rounded-lg transition-colors text-base sm:text-sm ${ratingConfig[rating].color}`}
              >
                {ratingConfig[rating].label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
