import { useState, useRef } from 'react'
import { Image, Eye, Edit3, Loader2 } from 'lucide-react'
import { uploadFile } from '../lib/api'
import MarkdownRenderer from './MarkdownRenderer'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
}

export default function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 5,
}: MarkdownEditorProps) {
  const [preview, setPreview] = useState(false)
  const [uploading, setUploading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleImageUpload() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setUploading(true)
      try {
        const res = await uploadFile(file)
        insertAtCursor(`![${file.name}](${res.url})`)
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    }
    input.click()
  }

  async function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (!file) continue
        setUploading(true)
        try {
          const res = await uploadFile(file)
          insertAtCursor(`![${file.name}](${res.url})`)
        } catch (err) {
          alert(err instanceof Error ? err.message : 'Upload failed')
        } finally {
          setUploading(false)
        }
        break
      }
    }
  }

  function insertAtCursor(text: string) {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const newValue = value.slice(0, start) + text + value.slice(end)
    onChange(newValue)
    setTimeout(() => {
      el.focus()
      el.selectionStart = el.selectionEnd = start + text.length
    }, 0)
  }

  return (
    <div className="border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
      <div className="flex items-center justify-between px-2 py-1.5 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPreview(false)}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded ${
              !preview ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit
          </button>
          <button
            type="button"
            onClick={() => setPreview(true)}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded ${
              preview ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Eye className="w-3.5 h-3.5" /> Preview
          </button>
        </div>
        <button
          type="button"
          onClick={handleImageUpload}
          disabled={uploading}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 rounded transition-colors disabled:opacity-50"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Image className="w-3.5 h-3.5" />}
          Image
        </button>
      </div>

      {preview ? (
        <div className="px-3 py-2 min-h-[120px]">
          {value.trim() ? (
            <MarkdownRenderer text={value} />
          ) : (
            <p className="text-slate-400">Nothing to preview</p>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          placeholder={placeholder}
          className="w-full px-3 py-2 focus:outline-none resize-none font-mono text-sm"
        />
      )}
    </div>
  )
}
