import type { Order, OrderInput, Product } from './types'

// Same origin: the Vite proxy (dev) or Amplify rewrite (prod) forwards /api/* to the backend.
const BASE_URL = '/api'

/** status 0 means the request never got a response (offline, DNS, connection reset). */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Worth retrying: no response at all, or a server-side failure. 4xx answers are final. */
export function isRetryable(error: ApiError): boolean {
  return error.status === 0 || error.status >= 500
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return new ApiError(0, 'Something went wrong, please try again')
}

interface ValidationIssue {
  loc?: (string | number)[]
  msg?: string
}

// FastAPI returns {detail: "message"} for our errors and {detail: [{loc, msg}, ...]} for validation.
function messageFrom(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    const { loc = [], msg = 'Invalid value' } = detail[0] as ValidationIssue
    const field = loc.at(-1)
    return typeof field === 'string' && field !== 'body' ? `${field.replace(/_/g, ' ')}: ${msg}` : msg
  }
  return status >= 500 ? 'Something went wrong, please try again' : `Request failed (${status})`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
    })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.')
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(response.status, messageFrom(body, response.status))
  return body as T
}

export const api = {
  getProducts: () => request<Product[]>('/products'),

  getOrders: () => request<Order[]>('/orders'),

  createOrder: (input: OrderInput, idempotencyKey: string) =>
    request<Order>('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(input),
    }),

  cancelOrder: (orderId: string) =>
    request<Order>(`/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' }),
}

/**
 * Retries `fn` on network errors and 5xx with a growing delay. Only for requests that are
 * safe to repeat; placing an order is, because every attempt carries the same Idempotency-Key.
 */
export async function withRetry<T>(fn: () => Promise<T>, { retries = 2, delayMs = 500 } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      const apiError = toApiError(error)
      if (attempt >= retries || !isRetryable(apiError)) throw apiError
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
    }
  }
}
