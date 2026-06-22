import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api, type Deck } from '../lib/api'
import DeckSelect from './DeckSelect'

interface EditDeckModalProps {
  deck: Deck | null
  decks: Deck[]
  onClose: () => void
  onSaved: () => void
}

function getDescendantIds(deckId: string, decks: Deck[]): string[] {
  const result: string[] = []
  const children = decks.filter((d) => d.parent_id === deckId)
  children.forEach((child) => {
    result.push(child.id)
    result.push(...getDescendantIds(child.id, decks))
  })
  return result
}

export default function EditDeckModal({ deck, decks, onClose, onSaved }: EditDeckModalProps) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (deck) {
      setName(deck.name)
      setParentId(deck.parent_id || '')
      setError('')
    }
  }, [deck])

  const excludeIds = useMemo(() => {
    if (!deck) return []
    return [deck.id, ...getDescendantIds(deck.id, decks)]
  }, [deck, decks])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!deck || !name.trim()) return
    setSaving(true)
    try {
      await api.put(`/decks/${deck.id}`, {
        name: name.trim(),
        parent_id: parentId || null,
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save deck')
    } finally {
      setSaving(false)
    }
  }

  if (!deck) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-800">Edit Deck</h2>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Parent Deck</label>
            <DeckSelect
              decks={decks}
              value={parentId}
              onChange={setParentId}
              placeholder="Root directory"
              excludeIds={excludeIds}
              className="w-full"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
