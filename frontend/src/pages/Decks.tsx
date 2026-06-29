import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FolderOpen,
  Folder,
  Plus,
  Brain,
  Search,
  LayoutGrid,
  List,
  Trash2,
  MoreHorizontal,
  ChevronRight,
  ChevronDown,
  CornerDownRight,
  ArrowLeftRight,
  Pencil,
} from 'lucide-react'
import { api, type Deck } from '../lib/api'
import EditDeckModal from '../components/EditDeckModal'
import DeckSelect from '../components/DeckSelect'

type ViewMode = 'grid' | 'tree'

interface TreeNode {
  deck: Deck
  children: TreeNode[]
}

function buildTree(decks: Deck[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  decks.forEach((d) => map.set(d.id, { deck: d, children: [] }))
  const roots: TreeNode[] = []
  decks.forEach((d) => {
    const node = map.get(d.id)!
    if (d.parent_id && map.has(d.parent_id)) {
      map.get(d.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  // Sort each level alphabetically
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.deck.name.localeCompare(b.deck.name))
    nodes.forEach((n) => sortNodes(n.children))
  }
  sortNodes(roots)
  return roots
}

function getDescendantIds(deckId: string, decks: Deck[]): string[] {
  const result: string[] = []
  const map = new Map<string, string[]>()
  decks.forEach((d) => {
    if (!map.has(d.parent_id || '')) map.set(d.parent_id || '', [])
    map.get(d.parent_id || '')!.push(d.id)
  })
  const walk = (id: string) => {
    result.push(id)
    ;(map.get(id) || []).forEach(walk)
  }
  walk(deckId)
  return result
}

function getTotalCardCount(deckId: string, decks: Deck[]): number {
  const deck = decks.find((d) => d.id === deckId)
  if (!deck) return 0
  let total = deck.card_count ?? 0
  decks
    .filter((d) => d.parent_id === deckId)
    .forEach((child) => {
      total += getTotalCardCount(child.id, decks)
    })
  return total
}

function getChildDeckCount(deckId: string, decks: Deck[]): number {
  return decks.filter((d) => d.parent_id === deckId).length
}

export default function Decks() {
  const [decks, setDecks] = useState<Deck[]>([])
  const [search, setSearch] = useState('')
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null)

  async function fetchDecks(query?: string) {
    setLoading(true)
    try {
      const endpoint = query ? `/decks/search?q=${encodeURIComponent(query)}` : '/decks'
      const data = await api.get<Deck[]>(endpoint)
      setDecks(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load decks')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDecks()
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDecks(search || undefined)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      await api.post('/decks', {
        name,
        parent_id: parentId || null,
      })
      setName('')
      setParentId('')
      await fetchDecks(search || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create deck')
    } finally {
      setCreating(false)
    }
  }

  async function handleCreateSub(parentId: string, subName: string) {
    if (!subName.trim()) return
    try {
      await api.post('/decks', {
        name: subName,
        parent_id: parentId,
      })
      setExpanded((prev) => new Set(prev).add(parentId))
      await fetchDecks(search || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sub-deck')
    }
  }

  async function handleMove(deckId: string, newParentId: string | null) {
    const deck = decks.find((d) => d.id === deckId)
    if (!deck) return
    try {
      await api.put(`/decks/${deckId}`, {
        name: deck.name,
        parent_id: newParentId,
      })
      await fetchDecks(search || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move deck')
    }
  }

  async function handleDelete(deckId: string, deckName: string) {
    if (!confirm(`Delete deck "${deckName}" and all its sub-decks/cards?`)) return
    try {
      await api.delete(`/decks/${deckId}`)
      await fetchDecks(search || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete deck')
    }
  }

  function toggleExpanded(deckId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(deckId)) next.delete(deckId)
      else next.add(deckId)
      return next
    })
  }

  const tree = useMemo(() => buildTree(decks), [decks])

  const createForm = (
    <form onSubmit={handleCreate} className="flex flex-wrap items-center gap-2">
      <DeckSelect
        decks={decks}
        value={parentId}
        onChange={setParentId}
        placeholder="Root directory"
        className="text-sm py-1.5"
      />
      <input
        type="text"
        placeholder="New deck name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-48 px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <button
        type="submit"
        disabled={creating || !name.trim()}
        className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg transition-colors"
        title="Create deck"
      >
        <Plus className="w-4 h-4" />
      </button>
    </form>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Your Decks</h1>
        {createForm}
      </div>

      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search across all decks by name or card content…"
              className="w-full pl-10 pr-4 py-3 text-base border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="flex items-center bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-colors ${
                viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Grid view"
            >
              <LayoutGrid className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewMode('tree')}
              className={`p-2 rounded-md transition-colors ${
                viewMode === 'tree' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
              title="Tree view"
            >
              <List className="w-5 h-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-slate-500">Loading…</div>
        ) : decks.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            {search ? 'No decks match your search.' : 'No decks yet. Create one to get started.'}
          </div>
        ) : viewMode === 'grid' ? (
          <GridView decks={decks} onDelete={handleDelete} onEdit={setEditingDeck} />
        ) : (
          <TreeView
            nodes={tree}
            decks={decks}
            expanded={expanded}
            onToggleExpand={toggleExpanded}
            onDelete={handleDelete}
            onCreateSub={handleCreateSub}
            onMove={handleMove}
            onEdit={setEditingDeck}
          />
        )}
      </div>

      <EditDeckModal
        deck={editingDeck}
        decks={decks}
        onClose={() => setEditingDeck(null)}
        onSaved={() => fetchDecks(search || undefined)}
      />
    </div>
  )
}

function GridView({ decks, onDelete, onEdit }: { decks: Deck[]; onDelete: (id: string, name: string) => void; onEdit: (deck: Deck) => void }) {
  return (
    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {decks.map((deck) => {
        const totalCards = getTotalCardCount(deck.id, decks)
        const subDeckCount = getChildDeckCount(deck.id, decks)
        return (
          <li key={deck.id}>
            <div className="group relative h-full p-4 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-200 rounded-lg transition-colors">
              <Link to={`/decks/${deck.id}`} className="block">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <FolderOpen className="w-5 h-5 text-indigo-600 flex-shrink-0" />
                    <span className="font-medium text-slate-800 truncate">{deck.name}</span>
                  </div>
                  <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full flex-shrink-0">
                    {subDeckCount > 0 ? `${subDeckCount} sub-deck${subDeckCount === 1 ? '' : 's'} · ` : ''}
                    {totalCards} card{totalCards === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  Created {new Date(deck.created_at).toLocaleDateString()}
                </p>
              </Link>
              <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onEdit(deck)}
                  className="p-1.5 bg-white text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-md border border-slate-200"
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <Link
                  to={`/study?deckId=${deck.id}`}
                  className="p-1.5 bg-indigo-600 text-white rounded-md"
                  title="Study"
                >
                  <Brain className="w-3.5 h-3.5" />
                </Link>
                <button
                  onClick={() => onDelete(deck.id, deck.name)}
                  className="p-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-md"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

interface TreeViewProps {
  nodes: TreeNode[]
  decks: Deck[]
  expanded: Set<string>
  onToggleExpand: (id: string) => void
  onDelete: (id: string, name: string) => void
  onCreateSub: (parentId: string, name: string) => void
  onMove: (deckId: string, newParentId: string | null) => void
  onEdit: (deck: Deck) => void
}

function TreeView({
  nodes,
  decks,
  expanded,
  onToggleExpand,
  onDelete,
  onCreateSub,
  onMove,
  onEdit,
}: TreeViewProps) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.deck.id}
          node={node}
          decks={decks}
          level={0}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          onDelete={onDelete}
          onCreateSub={onCreateSub}
          onMove={onMove}
          onEdit={onEdit}
        />
      ))}
    </ul>
  )
}

interface TreeNodeRowProps {
  node: TreeNode
  decks: Deck[]
  level: number
  expanded: Set<string>
  onToggleExpand: (id: string) => void
  onDelete: (id: string, name: string) => void
  onCreateSub: (parentId: string, name: string) => void
  onMove: (deckId: string, newParentId: string | null) => void
  onEdit: (deck: Deck) => void
}

function TreeNodeRow({
  node,
  decks,
  level,
  expanded,
  onToggleExpand,
  onDelete,
  onCreateSub,
  onMove,
  onEdit,
}: TreeNodeRowProps) {
  const { deck, children } = node
  const isExpanded = expanded.has(deck.id)
  const hasChildren = children.length > 0
  const [addingSub, setAddingSub] = useState(false)
  const [subName, setSubName] = useState('')
  const [showMove, setShowMove] = useState(false)

  const excludeIds = useMemo(() => getDescendantIds(deck.id, decks), [deck.id, decks])
  const moveCandidates = decks.filter(
    (d) => d.id !== deck.id && !excludeIds.includes(d.id)
  )
  const totalCards = useMemo(() => getTotalCardCount(deck.id, decks), [deck.id, decks])

  return (
    <li>
      <div
        className="group flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-colors"
        style={{ paddingLeft: `${12 + level * 24}px` }}
      >
        <button
          onClick={() => onToggleExpand(deck.id)}
          className={`p-1 rounded-md transition-colors ${
            hasChildren ? 'text-slate-500 hover:bg-slate-200' : 'text-transparent'
          }`}
          disabled={!hasChildren}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <Link
          to={`/decks/${deck.id}`}
          className="flex items-center gap-2 min-w-0 flex-1 text-slate-800 hover:text-indigo-600"
          title={deck.name}
        >
          {hasChildren ? (
            <FolderOpen className="w-4 h-4 text-indigo-600 flex-shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-slate-400 flex-shrink-0" />
          )}
          <span className="font-medium truncate">{deck.name}</span>
          <span className="text-xs text-slate-400 flex-shrink-0">
            {hasChildren ? `${children.length} sub-deck${children.length === 1 ? '' : 's'} · ` : ''}
            {totalCards} card{totalCards === 1 ? '' : 's'}
          </span>
        </Link>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={() => onEdit(deck)}
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setAddingSub(true)}
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
            title="Create sub-deck"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          <Link
            to={`/study?deckId=${deck.id}`}
            className={`p-1.5 rounded-md transition-colors ${
              totalCards > 0
                ? 'text-indigo-600 hover:bg-indigo-50'
                : 'text-slate-300 cursor-not-allowed pointer-events-none'
            }`}
            title="Study"
          >
            <Brain className="w-3.5 h-3.5" />
          </Link>

          <div className="relative">
            <button
              onClick={() => setShowMove((s) => !s)}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
              title="Move to"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
            {showMove && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1">
                <button
                  onClick={() => {
                    onMove(deck.id, null)
                    setShowMove(false)
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 text-slate-700"
                >
                  根目录
                </button>
                {moveCandidates.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      onMove(deck.id, d.id)
                      setShowMove(false)
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 text-slate-700 truncate"
                    title={d.name}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => onDelete(deck.id, deck.name)}
            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"
            title="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <Link
            to={`/decks/${deck.id}`}
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
            title="Open"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {addingSub && (
        <div
          className="flex items-center gap-2 py-2 px-3"
          style={{ paddingLeft: `${36 + level * 24}px` }}
        >
          <CornerDownRight className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            autoFocus
            value={subName}
            onChange={(e) => setSubName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onCreateSub(deck.id, subName)
                setSubName('')
                setAddingSub(false)
              } else if (e.key === 'Escape') {
                setSubName('')
                setAddingSub(false)
              }
            }}
            onBlur={() => {
              if (subName.trim()) {
                onCreateSub(deck.id, subName)
              }
              setSubName('')
              setAddingSub(false)
            }}
            placeholder="Sub-deck name"
            className="flex-1 max-w-xs px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      )}

      {hasChildren && isExpanded && (
        <ul>
          {children.map((child) => (
            <TreeNodeRow
              key={child.deck.id}
              node={child}
              decks={decks}
              level={level + 1}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onDelete={onDelete}
              onCreateSub={onCreateSub}
              onMove={onMove}
              onEdit={onEdit}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
