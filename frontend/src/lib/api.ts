export const API_BASE = '/api'

export function getToken(): string | null {
  return localStorage.getItem('token')
}

export function setToken(token: string) {
  localStorage.setItem('token', token)
}

export function clearToken() {
  localStorage.removeItem('token')
}

export function getAuthHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`
  const headers = new Headers(options.headers)
  const authHeaders = getAuthHeaders()
  Object.entries(authHeaders).forEach(([k, v]) => headers.set(k, v))
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(url, {
    ...options,
    headers,
  })

  if (!res.ok) {
    let message = `Request failed: ${res.status}`
    try {
      const data = await res.json()
      message = data.message || data.error || message
    } catch {
      // ignore
    }
    throw new Error(message)
  }

  // Handle empty body for 204
  if (res.status === 204) {
    return undefined as T
  }
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
}

export async function uploadFile(file: File): Promise<{ url: string; filename: string; original_name: string }> {
  const formData = new FormData()
  formData.append('file', file)
  return api.postForm('/media/upload', formData)
}

export async function exportApkg(deckId: string): Promise<Blob> {
  const url = `${API_BASE}/export/apkg/${deckId}`
  const res = await fetch(url, { headers: getAuthHeaders() })
  if (!res.ok) {
    let message = `Export failed: ${res.status}`
    try {
      const data = await res.json()
      message = data.message || data.error || message
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  return res.blob()
}

export interface LoginResponse {
  token: string
  user: { id: string; email: string; username: string }
}

export interface MediaItem {
  url: string
  type: 'image' | 'audio'
  name: string
}

export interface Deck {
  id: string
  user_id: string
  name: string
  parent_id: string | null
  config: string
  created_at: string
  card_count?: number
}

export interface Card {
  id: string
  user_id: string
  deck_id: string
  front: string
  back: string
  tags: string[]
  media: MediaItem[]
  managed: boolean
  state: string
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  reps: number
  lapses: number
  last_review: string | null
  linked_card_ids: string[]
  created_at: string
  updated_at: string
}

export interface StudyQueueItem extends Card {
  retrievability: number
}

export interface ReviewResponse {
  card: Card
  interval_days: number
}

export interface ReviewPlanItem {
  date: string
  count: number
  cards: Card[]
}

export interface Stats {
  total_cards: number
  due_today: number
  reviewed_today: number
  new_cards: number
  retention: number
}

export interface ImportResult {
  imported: number
  message: string
}

export interface CardCandidate {
  front: string
  back: string
  tags: string[]
  source: string
}

export interface PreviewImportResponse {
  deck_id: string
  cards: CardCandidate[]
  ai_fallback_used: boolean
  source: string
}
