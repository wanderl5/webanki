import { useState } from 'react'
import { FileQuestion, X } from 'lucide-react'
import type { MediaItem } from '../lib/api'

interface MediaRendererProps {
  media: MediaItem[]
  className?: string
}

export default function MediaRenderer({ media, className = '' }: MediaRendererProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  if (!media || media.length === 0) return null

  return (
    <>
      <div className={`flex flex-col gap-3 ${className}`}>
        {media.map((item, i) => {
          if (item.type === 'image') {
            return (
              <button
                key={i}
                type="button"
                onClick={() => setLightboxSrc(item.url)}
                className="block text-left"
              >
                <img
                  src={item.url}
                  alt={item.name}
                  className="max-w-full max-h-64 h-auto rounded-lg border border-slate-200 cursor-zoom-in"
                  loading="lazy"
                />
              </button>
            )
          }
          if (item.type === 'audio') {
            return (
              <audio key={i} controls src={item.url} className="w-full">
                Your browser does not support the audio element.
              </audio>
            )
          }
          return (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-sm text-indigo-600 hover:underline"
            >
              <FileQuestion className="w-4 h-4" />
              {item.name || 'Attachment'}
            </a>
          )
        })}
      </div>

      {lightboxSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 p-2 text-white/80 hover:text-white bg-black/30 hover:bg-black/50 rounded-full transition-colors"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxSrc}
            alt="Preview"
            className="max-w-full max-h-[90vh] object-contain rounded shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
