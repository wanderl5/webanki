import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { api, type Card, type Deck, type MediaItem } from '../lib/api'
import MarkdownEditor from '../components/MarkdownEditor'
import MediaUpload from '../components/MediaUpload'
import DeckSelect from '../components/DeckSelect'

export default function CardEdit() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [card, setCard] = useState<Card | null>(null)
  const [decks, setDecks] = useState<Deck[]>([])
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [tags, setTags] = useState('')
  const [media, setMedia] = useState<MediaItem[]>([])
  const [deckId, setDeckId] = useState('')
  const [managed, setManaged] = useState(true)
  const [deckCards, setDeckCards] = useState<Card[]>([])
  const [linkedCardIds, setLinkedCardIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    Promise.all([api.get<Card>(`/cards/${id}`), api.get<Deck[]>('/decks')])
      .then(([cardData, decksData]) => {
        setCard(cardData)
        setDecks(decksData)
        setFront(cardData.front)
        setBack(cardData.back)
        setTags(cardData.tags.join(', '))
        setMedia(cardData.media || [])
        setDeckId(cardData.deck_id)
        setManaged(cardData.managed ?? true)
        setLinkedCardIds(cardData.linked_card_ids || [])
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load card')
        setLoading(false)
      })
  }, [id])

  useEffect(() => {
    if (!deckId || !id) {
      setDeckCards([])
      return
    }
    api
      .get<Card[]>(`/decks/${deckId}/cards`)
      .then((cards) => setDeckCards(cards.filter((c) => c.id !== id)))
      .catch(() => setDeckCards([]))
  }, [deckId, id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!id || !deckId) return
    setSaving(true)
    setError('')
    try {
      await api.put(`/cards/${id}`, {
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
      setError(err instanceof Error ? err.message : 'Failed to update card')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Loading…</div>
  if (!card) return <div className="text-center py-12 text-red-600">{error || 'Card not found'}</div>

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-3 text-sm text-slate-500 mb-4">
        <Link to={`/decks/${card.deck_id}`} className="flex items-center gap-1 hover:text-indigo-600">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h1 className="text-2xl font-semibold mb-6">Edit Card</h1>
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
            <MarkdownEditor value={front} onChange={setFront} rows={3} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Back</label>
            <MarkdownEditor value={back} onChange={setBack} rows={5} />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Tags <span className="text-slate-400 font-normal">(comma separated)</span>
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
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
              to={`/decks/${deckId}`}
              className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
