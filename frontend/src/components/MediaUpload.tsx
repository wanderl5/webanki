import { useState } from 'react'
import { Image, Music, X, Loader2 } from 'lucide-react'
import { uploadFile, type MediaItem } from '../lib/api'

interface MediaUploadProps {
  media: MediaItem[]
  onChange: (media: MediaItem[]) => void
}

export default function MediaUpload({ media, onChange }: MediaUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>, type: MediaItem['type']) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const res = await uploadFile(file)
      onChange([...media, { url: res.url, type, name: res.original_name }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function removeItem(index: number) {
    onChange(media.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-slate-700">Media</label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      {media.length > 0 && (
        <ul className="space-y-2">
          {media.map((item, index) => (
            <li
              key={index}
              className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
            >
              <div className="flex items-center gap-2 min-w-0">
                {item.type === 'image' ? (
                  <Image className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                ) : (
                  <Music className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                )}
                <span className="text-sm text-slate-700 truncate">{item.name}</span>
              </div>
              <button
                type="button"
                onClick={() => removeItem(index)}
                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <label className="flex-1 cursor-pointer">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => handleFileSelect(e, 'image')}
            className="hidden"
            disabled={uploading}
          />
          <span className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Image className="w-4 h-4" />}
            Add Image
          </span>
        </label>
        <label className="flex-1 cursor-pointer">
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => handleFileSelect(e, 'audio')}
            className="hidden"
            disabled={uploading}
          />
          <span className="flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Music className="w-4 h-4" />}
            Add Audio
          </span>
        </label>
      </div>
    </div>
  )
}
