import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Eye, CheckCircle2, Search, ChevronLeft, ChevronRight } from 'lucide-react'
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
  const [keyword, setKeyword] = useState('')

  const filteredQueue = queue.filter((item) => {
    const lower = keyword.toLowerCase()
    const text = `${item.front}\n${item.back}\n${item.tags?.join(' ') ?? ''}`.toLowerCase()
    return text.includes(lower)
  })

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

  useEffect(() => {
    setCurrentIndex(0)
    setShowBack(false)
    setCompleted(false)
  }, [keyword])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (completed || filteredQueue.length === 0) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setCurrentIndex((i) => Math.max(0, i - 1))
        setShowBack(false)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setCurrentIndex((i) => Math.min(filteredQueue.length - 1, i + 1))
        setShowBack(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [completed, filteredQueue.length])

  async function handleRate(rating: Rating) {
    const card = filteredQueue[currentIndex]
    if (!card) return
    try {
      const res = await api.post<ReviewResponse>(`/study/${card.id}/review`, { rating })
      setLastInterval(res.interval_days)
      setShowBack(false)
      if (currentIndex + 1 >= filteredQueue.length) {
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

  const card = filteredQueue[currentIndex]
  if (!card) {
    const emptyByKeyword = queue.length > 0 && filteredQueue.length === 0
    return (
      <div className="max-w-xl mx-auto text-center py-16 bg-white rounded-xl border border-slate-200">
        <p className="text-slate-600 mb-4">
          {emptyByKeyword
            ? 'No cards match your keyword.'
            : 'No cards available.'}
        </p>
        {emptyByKeyword && (
          <button
            onClick={() => setKeyword('')}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
          >
            Clear keyword
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex items-center justify-between">
          <Link
            to={deckId ? `/decks/${deckId}` : '/decks'}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
              className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed"
              title="Previous"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-slate-600 min-w-[100px] text-center">
              {currentIndex + 1} / {filteredQueue.length}
            </span>
            <button
              onClick={() =>
                setCurrentIndex((i) => Math.min(filteredQueue.length - 1, i + 1))
              }
              disabled={currentIndex >= filteredQueue.length - 1}
              className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed"
              title="Next"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value)
                setCurrentIndex(0)
                setShowBack(false)
              }}
              placeholder="Search front / back / tags"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-500">Go to</span>
            <input
              type="number"
              min={1}
              max={filteredQueue.length}
              value={currentIndex + 1}
              onChange={(e) => {
                const value = parseInt(e.target.value, 10)
                if (!isNaN(value)) {
                  setCurrentIndex(Math.max(0, Math.min(filteredQueue.length - 1, value - 1)))
                  setShowBack(false)
                }
              }}
              className="w-16 px-2 py-2 text-sm text-center border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 whitespace-nowrap">Progress</span>
          <input
            type="range"
            min={1}
            max={filteredQueue.length}
            value={currentIndex + 1}
            onChange={(e) => {
              setCurrentIndex(parseInt(e.target.value, 10) - 1)
              setShowBack(false)
            }}
            className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
        </div>
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
