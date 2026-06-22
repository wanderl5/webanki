import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  FileText,
  Globe,
  Upload,
  Image,
  CheckCircle2,
  Trash2,
  Plus,
  Sparkles,
  AlertCircle,
} from 'lucide-react'
import {
  api,
  getAuthHeaders,
  type Deck,
  type CardCandidate,
  type PreviewImportResponse,
  type ImportResult,
} from '../lib/api'
import DeckSelect from '../components/DeckSelect'

type Source = 'text' | 'url' | 'file' | 'image'

export default function Import() {
  const navigate = useNavigate()
  const [decks, setDecks] = useState<Deck[]>([])
  const [deckId, setDeckId] = useState('')
  const [source, setSource] = useState<Source>('text')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [removeHandwriting, setRemoveHandwriting] = useState(false)
  const [useAi, setUseAi] = useState(true)
  const [preview, setPreview] = useState<PreviewImportResponse | null>(null)
  const [cleanedImageUrl, setCleanedImageUrl] = useState<string | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    api
      .get<Deck[]>('/decks')
      .then((data) => {
        setDecks(data)
        if (data.length > 0 && !deckId) setDeckId(data[0].id)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load decks'))
  }, [])

  async function handlePreview(e: React.FormEvent) {
    e.preventDefault()
    if (!deckId) {
      setError('Please select a deck')
      return
    }
    setLoading(true)
    setError('')
    try {
      if (source === 'text') {
        if (!text.trim()) {
          setError('Please paste some text')
          setLoading(false)
          return
        }
        const res = await api.post<PreviewImportResponse>('/import/preview', {
          deck_id: deckId,
          text: text.trim(),
          use_ai: useAi,
        })
        setPreview(res)
      } else if (source === 'url') {
        if (!url.trim()) {
          setError('Please enter a URL')
          setLoading(false)
          return
        }
        const res = await api.post<PreviewImportResponse>('/import/preview', {
          deck_id: deckId,
          url: url.trim(),
          use_ai: useAi,
        })
        setPreview(res)
      } else if (source === 'file') {
        if (!file) {
          setError('Please select a file')
          setLoading(false)
          return
        }
        const formData = new FormData()
        formData.append('deck_id', deckId)
        formData.append('use_ai', useAi.toString())
        formData.append('file', file)
        const res = await api.postForm<PreviewImportResponse>('/import/file', formData)
        setPreview(res)
      } else if (source === 'image') {
        if (!imageFile) {
          setError('Please select an image')
          setLoading(false)
          return
        }
        const formData = new FormData()
        formData.append('deck_id', deckId)
        formData.append('remove_handwriting', removeHandwriting.toString())
        formData.append('file', imageFile)
        const res = await api.postForm<PreviewImportResponse>('/import/image', formData)
        setPreview(res)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleCleanImage() {
    if (!imageFile) {
      setError('Please select an image')
      return
    }
    setCleaning(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', imageFile)
      const res = await fetch('/api/import/image/clean', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || data.error || `Clean failed: ${res.status}`)
      }
      const blob = await res.blob()
      setCleanedImageUrl(URL.createObjectURL(blob))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local cleaning failed')
    } finally {
      setCleaning(false)
    }
  }

  async function handleExtractFromCleanedImage() {
    if (!cleanedImageUrl || !deckId) return
    setLoading(true)
    setError('')
    try {
      const blob = await fetch(cleanedImageUrl).then((r) => r.blob())
      const file = new File([blob], 'cleaned.png', { type: 'image/png' })
      const formData = new FormData()
      formData.append('deck_id', deckId)
      formData.append('remove_handwriting', 'false')
      formData.append('file', file)
      const res = await api.postForm<PreviewImportResponse>('/import/image', formData)
      setPreview(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extract failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleCommit() {
    if (!preview || preview.cards.length === 0) return
    setCommitting(true)
    setError('')
    try {
      const res = await api.post<ImportResult>('/import/commit', {
        deck_id: deckId,
        cards: preview.cards,
      })
      setResult(res)
      setPreview(null)
      setText('')
      setUrl('')
      setFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setCommitting(false)
    }
  }

  function updateCandidate(index: number, field: keyof CardCandidate, value: string) {
    if (!preview) return
    const cards = [...preview.cards]
    cards[index] = { ...cards[index], [field]: value }
    setPreview({ ...preview, cards })
  }

  function removeCandidate(index: number) {
    if (!preview) return
    const cards = preview.cards.filter((_, i) => i !== index)
    setPreview({ ...preview, cards })
  }

  function addCandidate() {
    if (!preview) return
    setPreview({
      ...preview,
      cards: [...preview.cards, { front: '', back: '', tags: [], source: 'manual' }],
    })
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-3 text-sm text-slate-500 mb-4">
        <Link to="/decks" className="flex items-center gap-1 hover:text-indigo-600">
          <ArrowLeft className="w-4 h-4" /> Decks
        </Link>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Upload className="w-6 h-6 text-indigo-600" />
          <h1 className="text-2xl font-semibold">Import Cards</h1>
        </div>

        {result && (
          <div className="mb-6 p-4 bg-emerald-50 text-emerald-800 rounded-lg flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 mt-0.5" />
            <div>
              <p className="font-medium">Import complete</p>
              <p className="text-sm">{result.message}</p>
              <button
                onClick={() => navigate(`/decks/${deckId}`)}
                className="mt-2 text-sm text-emerald-700 hover:underline"
              >
                View deck →
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2 mb-6">
          {([
            { key: 'text', label: 'Text', icon: FileText },
            { key: 'url', label: 'URL', icon: Globe },
            { key: 'file', label: 'File / PDF / apkg', icon: Upload },
            { key: 'image', label: 'Image', icon: Image },
          ] as { key: Source; label: string; icon: typeof FileText }[]).map(
            ({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => {
                  setSource(key)
                  setPreview(null)
                  setError('')
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                  source === key
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            )
          )}
        </div>

        <form onSubmit={handlePreview} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Target Deck</label>
            <DeckSelect
              decks={decks}
              value={deckId}
              onChange={setDeckId}
              placeholder="Select a deck"
              className="w-full"
            />
          </div>

          {source === 'text' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Text to Import
              </label>
              <textarea
                rows={10}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`What is the capital of France?\nParis\n\nWhat is 2 + 2?\n4`}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm"
              />
            </div>
          )}

          {source === 'url' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Web URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {source === 'file' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                File (PDF, .apkg, .txt, .md)
              </label>
              <input
                type="file"
                accept=".pdf,.apkg,.txt,.md"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-indigo-50 file:text-indigo-700"
              />
            </div>
          )}

          {source === 'image' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Image (screenshot, photo, scan)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    setImageFile(e.target.files?.[0] || null)
                    setCleanedImageUrl(null)
                    setPreview(null)
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-indigo-50 file:text-indigo-700"
                />
              </div>

              {imageFile && (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={handleCleanImage}
                    disabled={cleaning}
                    className="flex-1 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 disabled:bg-slate-100 text-slate-700 font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {cleaning ? 'Cleaning…' : 'Clean Handwriting (Local)'}
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {loading ? 'Analyzing…' : 'Extract Cards (AI)'}
                  </button>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  id="removeHandwriting"
                  type="checkbox"
                  checked={removeHandwriting}
                  onChange={(e) => setRemoveHandwriting(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                />
                <label htmlFor="removeHandwriting" className="text-sm text-slate-700">
                  Ignore handwritten annotations when generating cards
                </label>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              id="useAi"
              type="checkbox"
              checked={useAi}
              onChange={(e) => setUseAi(e.target.checked)}
              className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
            />
            <label htmlFor="useAi" className="text-sm text-slate-700 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              Use AI fallback when rule extraction is empty
            </label>
          </div>

          {source !== 'image' && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <Link to="/decks" className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-colors"
              >
                {loading ? 'Generating preview…' : 'Preview Cards'}
              </button>
            </div>
          )}
        </form>

        {cleanedImageUrl && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <h2 className="text-lg font-semibold mb-4">Cleaned Image Preview</h2>
            <div className="mb-4 p-3 bg-amber-50 text-amber-800 rounded-lg text-sm">
              Local cleaning is heuristic-based and may not be perfect. If the result is unsatisfactory,
              use "Extract Cards (AI)" from the original image instead.
            </div>
            <img
              src={cleanedImageUrl}
              alt="Cleaned"
              className="max-h-96 rounded-lg border border-slate-200 mb-4"
            />
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setCleanedImageUrl(null)}
                className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium"
              >
                Back
              </button>
              <button
                onClick={handleExtractFromCleanedImage}
                disabled={loading}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-lg transition-colors"
              >
                {loading ? 'Analyzing…' : 'Generate Cards from Cleaned Image'}
              </button>
            </div>
          </div>
        )}

        {preview && (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">
                  Preview ({preview.cards.length} cards)
                </h2>
                {preview.ai_fallback_used && (
                  <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                    <Sparkles className="w-3 h-3" /> AI fallback was used
                  </p>
                )}
              </div>
              <button
                onClick={addCandidate}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" /> Add card
              </button>
            </div>

            {preview.cards.length === 0 ? (
              <p className="text-slate-500 text-center py-8">
                No cards extracted. Try a different source or enable AI fallback.
              </p>
            ) : (
              <ul className="space-y-3 mb-6">
                {preview.cards.map((card, index) => (
                  <li
                    key={index}
                    className="bg-slate-50 rounded-lg border border-slate-200 p-4"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                      <input
                        type="text"
                        value={card.front}
                        onChange={(e) => updateCandidate(index, 'front', e.target.value)}
                        placeholder="Front"
                        className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                      />
                      <input
                        type="text"
                        value={card.back}
                        onChange={(e) => updateCandidate(index, 'back', e.target.value)}
                        placeholder="Back"
                        className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <input
                        type="text"
                        value={card.tags.join(', ')}
                        onChange={(e) =>
                          updateCandidate(
                            index,
                            'tags',
                            e.target.value
                          )
                        }
                        placeholder="Tags (comma separated)"
                        className="flex-1 px-3 py-1.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                      />
                      <button
                        onClick={() => removeCandidate(index)}
                        className="ml-2 p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setPreview(null)}
                className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium"
              >
                Back
              </button>
              <button
                onClick={handleCommit}
                disabled={committing || preview.cards.length === 0}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-medium rounded-lg transition-colors"
              >
                {committing ? 'Importing…' : `Import ${preview.cards.length} Cards`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
