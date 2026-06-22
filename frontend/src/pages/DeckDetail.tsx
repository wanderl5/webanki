import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Pencil, Trash2, Plus, ArrowLeft, Brain, Download, FolderOpen } from 'lucide-react'
import { api, exportApkg, type Deck, type Card } from '../lib/api'
import MarkdownRenderer from '../components/MarkdownRenderer'
import EditDeckModal from '../components/EditDeckModal'

function buildBreadcrumb(deckId: string, decks: Deck[]): Deck[] {
  const map = new Map(decks.map((d) => [d.id, d]))
  const path: Deck[] = []
  let current: Deck | undefined = map.get(deckId)
  while (current) {
    path.unshift(current)
    current = current.parent_id ? map.get(current.parent_id) : undefined
  }
  return path
}

export default function DeckDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [deck, setDeck] = useState<Deck | null>(null)
  const [allDecks, setAllDecks] = useState<Deck[]>([])
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [managedFilter, setManagedFilter] = useState<boolean | null>(null)
  const [exporting, setExporting] = useState(false)
  const [addingSub, setAddingSub] = useState(false)
  const [subName, setSubName] = useState('')
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null)

  async function fetchData() {
    if (!id) return
    setLoading(true)
    try {
      const params = managedFilter !== null ? `?managed=${managedFilter}` : ''
      const [deckData, decksData, cardsData] = await Promise.all([
        api.get<Deck>(`/decks/${id}`),
        api.get<Deck[]>('/decks'),
        api.get<Card[]>(`/decks/${id}/cards${params}`),
      ])
      setDeck(deckData)
      setAllDecks(decksData)
      setCards(cardsData)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deck')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [id, managedFilter])

  async function handleExport() {
    if (!deck) return
    setExporting(true)
    try {
      const blob = await exportApkg(deck.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${deck.name.replace(/::/g, '_')}.apkg`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleDeleteDeck() {
    if (!deck) return
    if (!confirm(`Delete deck "${deck.name}" and all its cards?`)) return
    try {
      await api.delete(`/decks/${deck.id}`)
      navigate('/decks')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete deck')
    }
  }

  async function handleDeleteCard(cardId: string) {
    if (!confirm('Delete this card?')) return
    try {
      await api.delete(`/cards/${cardId}`)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete card')
    }
  }

  async function handleCreateSub(e: React.FormEvent) {
    e.preventDefault()
    if (!deck || !subName.trim()) return
    try {
      await api.post('/decks', { name: subName, parent_id: deck.id })
      setSubName('')
      setAddingSub(false)
      await fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sub-deck')
    }
  }

  const filteredCards = cards.filter(
    (c) =>
      c.front.toLowerCase().includes(search.toLowerCase()) ||
      c.back.toLowerCase().includes(search.toLowerCase()) ||
      c.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  )

  if (loading) return <div className="text-center py-12 text-slate-500">Loading…</div>
  if (!deck) return <div className="text-center py-12 text-red-600">{error || 'Deck not found'}</div>

  const breadcrumb = buildBreadcrumb(deck.id, allDecks)
  const subDecks = allDecks.filter((d) => d.parent_id === deck.id)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500 mb-2">
        <Link to="/decks" className="flex items-center gap-1 hover:text-indigo-600">
          <ArrowLeft className="w-4 h-4" /> Decks
        </Link>
        {breadcrumb.map((d, idx) => (
          <span key={d.id} className="flex items-center gap-2">
            <span>/</span>
            {idx === breadcrumb.length - 1 ? (
              <span className="text-slate-800 font-medium">{d.name}</span>
            ) : (
              <Link to={`/decks/${d.id}`} className="hover:text-indigo-600">
                {d.name}
              </Link>
            )}
          </span>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{deck.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={cards.length > 0 ? `/study?deckId=${deck.id}` : '#'}
            onClick={(e) => {
              if (cards.length === 0) {
                e.preventDefault()
                alert('Add some cards to this deck before studying.')
              }
            }}
            className={`px-4 py-2 font-medium rounded-lg transition-colors flex items-center gap-2 ${
              cards.length > 0
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            <Brain className="w-4 h-4" /> Study
          </Link>
          <Link
            to={`/cards/new?deckId=${deck.id}`}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add Card
          </Link>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 text-slate-700 font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> {exporting ? 'Exporting…' : 'Export'}
          </button>
          <button
            onClick={() => setAddingSub(true)}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Sub-deck
          </button>
          <button
            onClick={() => deck && setEditingDeck(deck)}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg transition-colors flex items-center gap-2"
          >
            <Pencil className="w-4 h-4" /> Edit
          </button>
          <button
            onClick={handleDeleteDeck}
            className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete deck"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      {addingSub && (
        <form onSubmit={handleCreateSub} className="flex items-center gap-2 bg-white p-4 rounded-xl border border-slate-200">
          <FolderOpen className="w-5 h-5 text-indigo-600" />
          <input
            type="text"
            autoFocus
            value={subName}
            onChange={(e) => setSubName(e.target.value)}
            placeholder="New sub-deck name"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={!subName.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setAddingSub(false)
              setSubName('')
            }}
            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg"
          >
            Cancel
          </button>
        </form>
      )}

      {subDecks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-medium text-slate-700 mb-3">Sub-decks</h3>
          <div className="flex flex-wrap gap-3">
            {subDecks.map((sub) => (
              <Link
                key={sub.id}
                to={`/decks/${sub.id}`}
                className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg transition-colors"
              >
                <FolderOpen className="w-4 h-4 text-indigo-600" />
                <span className="text-sm font-medium text-slate-700">{sub.name}</span>
                <span className="text-xs text-slate-400">{sub.card_count ?? 0} cards</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <input
        type="text"
        placeholder="Search cards…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />

      <div className="flex flex-wrap items-center gap-2">
        {[
          { label: 'All', value: null },
          { label: 'Managed', value: true },
          { label: 'Unmanaged', value: false },
        ].map((opt) => (
          <button
            key={opt.label}
            onClick={() => setManagedFilter(opt.value as boolean | null)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
              managedFilter === opt.value
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {filteredCards.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
          <p className="text-slate-500">No cards yet.</p>
          <Link
            to={`/cards/new?deckId=${deck.id}`}
            className="inline-flex items-center gap-1 mt-4 text-indigo-600 hover:underline"
          >
            <Plus className="w-4 h-4" /> Create your first card
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {filteredCards.map((card) => (
            <li
              key={card.id}
              onDoubleClick={() => navigate(`/cards/${card.id}`)}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-200 transition-colors cursor-pointer"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <MarkdownRenderer
                    text={card.front}
                    className="line-clamp-2"
                  />
                  <MarkdownRenderer
                    text={card.back}
                    className="text-slate-600 mt-1 text-sm line-clamp-3"
                  />
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {!card.managed && (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                        Not managed
                      </span>
                    )}
                    {card.linked_card_ids.length > 0 && (
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full">
                        {card.linked_card_ids.length} linked
                      </span>
                    )}
                    {card.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    to={`/cards/${card.id}/edit`}
                    className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </Link>
                  <button
                    onClick={() => handleDeleteCard(card.id)}
                    className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <EditDeckModal
        deck={editingDeck}
        decks={allDecks}
        onClose={() => setEditingDeck(null)}
        onSaved={() => fetchData()}
      />
    </div>
  )
}
