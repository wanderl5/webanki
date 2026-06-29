import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, RotateCcw } from 'lucide-react'
import { api, type Card } from '../lib/api'
import MarkdownRenderer from '../components/MarkdownRenderer'
import MediaRenderer from '../components/MediaRenderer'

interface PaneState {
  card: Card
  showBack: boolean
}

function formatNextStudy(state: string, due: string): string {
  if (state === 'New') return '未安排'
  try {
    const dueDate = new Date(due)
    if (Number.isNaN(dueDate.getTime())) return '未安排'
    const now = new Date()
    const diffMs = dueDate.getTime() - now.getTime()
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return `已逾期 ${Math.abs(diffDays)} 天`
    if (diffDays === 0) return '今天'
    if (diffDays === 1) return '明天'
    if (diffDays <= 7) return `${diffDays} 天后`
    return dueDate.toLocaleDateString('zh-CN')
  } catch {
    return '未安排'
  }
}

export default function CardView() {
  const { id } = useParams<{ id: string }>()
  const [mainCard, setMainCard] = useState<Card | null>(null)
  const [linkedCards, setLinkedCards] = useState<Card[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeLinkedId, setActiveLinkedId] = useState<string | null>(null)
  const [panes, setPanes] = useState<PaneState[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api
      .get<Card>(`/cards/${id}`)
      .then(async (card) => {
        setMainCard(card)
        const linked = await Promise.all(
          (card.linked_card_ids || []).map((linkedId) =>
            api.get<Card>(`/cards/${linkedId}`).catch(() => null)
          )
        )
        const validLinked = linked.filter((c): c is Card => c !== null)
        setLinkedCards(validLinked)
        setPanes([{ card, showBack: false }])
        setSelectedIds([])
        setActiveLinkedId(null)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load card')
        setLoading(false)
      })
  }, [id])

  useEffect(() => {
    if (!mainCard) return
    const selected = linkedCards.filter((c) => selectedIds.includes(c.id))
    setPanes([
      { card: mainCard, showBack: false },
      ...selected.map((c) => ({ card: c, showBack: false })),
    ])
  }, [mainCard, linkedCards, selectedIds])

  function toggleLinked(linkedId: string) {
    setSelectedIds((prev) => {
      if (prev.includes(linkedId)) {
        setActiveLinkedId((current) => (current === linkedId ? null : current))
        return prev.filter((x) => x !== linkedId)
      }
      if (prev.length >= 4) {
        alert('最多同时对比 4 个关联卡片')
        return prev
      }
      setActiveLinkedId(linkedId)
      return [...prev, linkedId]
    })
  }

  function toggleBack(index: number) {
    setPanes((prev) =>
      prev.map((p, i) => (i === index ? { ...p, showBack: !p.showBack } : p))
    )
  }

  async function handleReset() {
    if (!mainCard) return
    if (!confirm('Reset this card’s study progress? It will become a new card.')) return
    try {
      const updated = await api.post<Card>(`/cards/${mainCard.id}/reset`, {})
      setMainCard(updated)
      setPanes((prev) =>
        prev.map((p, i) => (i === 0 ? { card: updated, showBack: false } : p))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset card')
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        if (activeLinkedId && selectedIds.includes(activeLinkedId)) {
          const index = panes.findIndex((p) => p.card.id === activeLinkedId)
          if (index > 0) {
            toggleBack(index)
            return
          }
        }
        toggleBack(0)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeLinkedId, selectedIds, panes])

  if (loading) return <div className="text-center py-12 text-slate-500">Loading…</div>
  if (!mainCard) return <div className="text-center py-12 text-red-600">{error || 'Card not found'}</div>

  const gridClass =
    panes.length === 1
      ? 'grid-cols-1'
      : panes.length === 2
      ? 'grid-cols-1 md:grid-cols-2'
      : panes.length === 3
      ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
      : panes.length === 4
      ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
        <Link to={`/decks/${mainCard.deck_id}`} className="flex items-center gap-1 hover:text-indigo-600">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
        <button
          onClick={handleReset}
          className="flex items-center gap-1 px-3 py-1.5 text-slate-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
        >
          <RotateCcw className="w-4 h-4" /> Reset progress
        </button>
      </div>

      {linkedCards.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="text-sm font-medium text-slate-700 mb-2">
            关联题目（最多选 4 个）
          </h3>
          <div className="flex flex-wrap gap-2">
            {linkedCards.map((c) => {
              const isSelected = selectedIds.includes(c.id)
              const isActive = activeLinkedId === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => toggleLinked(c.id)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors text-left max-w-xs truncate ${
                    isSelected
                      ? isActive
                        ? 'bg-indigo-600 text-white border-indigo-600 ring-2 ring-indigo-300 ring-offset-1'
                        : 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                  }`}
                  title={c.front}
                >
                  {c.front}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className={`grid ${gridClass} gap-4`}>
        {panes.map((pane, idx) => {
          const isActivePane =
            idx === 0 ? activeLinkedId === null : activeLinkedId === pane.card.id
          return (
            <div
              key={pane.card.id}
              tabIndex={0}
              role="article"
              aria-label={idx === 0 ? 'Main card' : `Linked card ${idx}`}
              onClick={() => setActiveLinkedId(idx === 0 ? null : pane.card.id)}
              onFocus={() => setActiveLinkedId(idx === 0 ? null : pane.card.id)}
              className={`bg-white rounded-xl border p-4 flex flex-col min-h-[200px] max-h-[80vh] overflow-y-auto transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                isActivePane
                  ? 'border-indigo-500 ring-1 ring-indigo-500'
                  : 'border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-slate-400">
                  {idx === 0 ? 'Main' : `Linked ${idx}`}
                </span>
                <button
                  tabIndex={-1}
                  onClick={() => toggleBack(idx)}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                >
                  {pane.showBack ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {pane.showBack ? 'Hide answer' : 'Show answer'}
                </button>
              </div>
              <div className="text-xs text-slate-400 mb-2">
                下次学习：{formatNextStudy(pane.card.state, pane.card.due)}
              </div>
              <div className="flex-1">
                <MarkdownRenderer text={pane.card.front} className="prose-img:max-h-64" />
                <MediaRenderer media={pane.card.media} className="mt-3" />
                {pane.showBack && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <MarkdownRenderer text={pane.card.back} className="prose-img:max-h-64" />
                    <MediaRenderer media={pane.card.media} className="mt-3" />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
