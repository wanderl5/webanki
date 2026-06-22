import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api, type Card, type Deck, type MediaItem } from '../lib/api'
import MarkdownEditor from '../components/MarkdownEditor'
import MediaUpload from '../components/MediaUpload'
import DeckSelect from '../components/DeckSelect'

export default function CardNew() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialDeckId = searchParams.get('deckId') || ''

  const [decks, setDecks] = useState<Deck[]>([])
  const [deckId, setDeckId] = useState(initialDeckId)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [tags, setTags] = useState('')
  const [media, setMedia] = useState<MediaItem[]>([])
  const [managed, setManaged] = useState(true)
  const [deckCards, setDeckCards] = useState<Card[]>([])
  const [linkedCardIds, setLinkedCardIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .get<Deck[]>('/decks')
      .then(setDecks)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load decks'))
  }, [])

  useEffect(() => {
    if (!deckId) {
      setDeckCards([])
      return
    }
    api
      .get<Card[]>(`/decks/${deckId}/cards`)
      .then(setDeckCards)
      .catch(() => setDeckCards([]))
  }, [deckId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!deckId) {
      setError('Please select a deck')
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.post('/cards', {
        deck_id: deckId,
        front: front.trim(),
        back: back.trim(),
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        media,
        managed,
        linked_card_ids: linkedCardIds,
      })
      navigate(`/decks/${deckId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create card')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 text-sm text-slate-500 mb-4">
        <Link to="/decks" className="flex items-center gap-1 hover:text-indigo-600">
          <ArrowLeft className="w-4 h-4" /> Decks
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h1 className="text-2xl font-semibold mb-6">Create Card</h1>
        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Deck</label>
            <DeckSelect
              decks={decks}
              value={deckId}
              onChange={setDeckId}
              placeholder="Select a deck"
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Front</label>
            <MarkdownEditor
              value={front}
              onChange={setFront}
              placeholder="Question or prompt"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Back</label>
            <MarkdownEditor
              value={back}
              onChange={setBack}
              placeholder="Answer"
              rows={5}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Tags <span className="text-slate-400 font-normal">(comma separated)</span>
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="e.g. vocabulary, chapter-1"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <MediaUpload media={media} onChange={setMedia} />

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={managed}
              onChange={(e) => setManaged(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-700">纳入记忆曲线管理（会定时复习）</span>
          </label>

          {deckCards.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">关联题目</label>
              <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 space-y-1">
                {deckCards.map((c) => (
                  <label key={c.id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={linkedCardIds.includes(c.id)}
                      onChange={(e) => {
                        setLinkedCardIds((prev) =>
                          e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                        )
                      }}
                      className="mt-0.5 w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                    />
                    <span className="line-clamp-2 text-slate-600">{c.front}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <Link
              to={deckId ? `/decks/${deckId}` : '/decks'}
              className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-colors"
            >
              {loading ? 'Creating…' : 'Create Card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
