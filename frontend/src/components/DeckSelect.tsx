import { useMemo, type ReactNode } from 'react'
import type { Deck } from '../lib/api'

interface DeckSelectProps {
  decks: Deck[]
  value: string
  onChange: (deckId: string) => void
  placeholder?: string
  excludeIds?: string[]
  className?: string
}

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
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.deck.name.localeCompare(b.deck.name))
    nodes.forEach((n) => sortNodes(n.children))
  }
  sortNodes(roots)
  return roots
}

function renderOptions(nodes: TreeNode[], excludeIds: Set<string>, level: number): ReactNode[] {
  const result: ReactNode[] = []
  nodes.forEach((node) => {
    if (!excludeIds.has(node.deck.id)) {
      const prefix = level > 0 ? '　'.repeat(level) + '└ ' : ''
      result.push(
        <option key={node.deck.id} value={node.deck.id}>
          {prefix}{node.deck.name}
        </option>
      )
      result.push(...renderOptions(node.children, excludeIds, level + 1))
    }
  })
  return result
}

export default function DeckSelect({
  decks,
  value,
  onChange,
  placeholder = 'Select a deck',
  excludeIds = [],
  className = '',
}: DeckSelectProps) {
  const tree = useMemo(() => buildTree(decks), [decks])
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds])

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white ${className}`}
    >
      <option value="">{placeholder}</option>
      {renderOptions(tree, excludeSet, 0)}
    </select>
  )
}
