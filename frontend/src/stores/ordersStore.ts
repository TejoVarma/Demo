import { create } from 'zustand'

import { api, isRetryable, toApiError, withRetry } from '../api/client'
import type { Order, OrderInput } from '../api/types'
import { useProductsStore } from './productsStore'

export type ActionResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string; skipped?: boolean }

interface PendingAttempt {
  key: string
  input: OrderInput
}

interface OrdersState {
  orders: Order[]
  loaded: boolean
  loading: boolean
  error: string | null
  placing: boolean
  /** Idempotency key of the last attempt whose outcome is unknown (network error / 5xx). */
  pendingAttempt: PendingAttempt | null
  /** Order ids with a cancel request in flight. */
  cancelling: Record<string, boolean>
  fetchOrders: () => Promise<void>
  placeOrder: (input: OrderInput) => Promise<ActionResult<Order>>
  cancelOrder: (orderId: string) => Promise<ActionResult<Order>>
}

export const initialOrdersState = {
  orders: [],
  loaded: false,
  loading: false,
  error: null,
  placing: false,
  pendingAttempt: null,
  cancelling: {},
} satisfies Partial<OrdersState>

// Returned when a duplicate call is ignored because the same action is still running.
const IN_FLIGHT: ActionResult<never> = { ok: false, status: 0, message: 'Already in progress', skipped: true }

function sameInput(a: OrderInput, b: OrderInput): boolean {
  return (
    a.product_id === b.product_id && a.quantity === b.quantity && a.customer_name.trim() === b.customer_name.trim()
  )
}

function upsert(orders: Order[], order: Order): Order[] {
  const rest = orders.filter((o) => o.id !== order.id)
  return [order, ...rest].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

const refreshProducts = () => void useProductsStore.getState().fetchProducts()

let latestRequest = 0

export const useOrdersStore = create<OrdersState>()((set, get) => ({
  ...initialOrdersState,

  fetchOrders: async () => {
    const requestId = ++latestRequest
    set({ loading: true })
    try {
      const orders = await api.getOrders()
      if (requestId !== latestRequest) return
      set({ orders, loaded: true, loading: false, error: null })
    } catch (error) {
      if (requestId !== latestRequest) return
      set({ loading: false, error: toApiError(error).message })
    }
  },

  placeOrder: async (input) => {
    // Gate 1: one order request at a time, whatever the UI does.
    if (get().placing) return IN_FLIGHT

    // Gate 2: resubmitting the same order after an unknown outcome reuses its key, so the
    // backend returns the original order instead of creating a second one.
    const pending = get().pendingAttempt
    const key = pending && sameInput(pending.input, input) ? pending.key : crypto.randomUUID()
    set({ placing: true, pendingAttempt: { key, input } })

    try {
      const order = await withRetry(() => api.createOrder(input, key))
      set((state) => ({ orders: upsert(state.orders, order), pendingAttempt: null }))
      refreshProducts()
      return { ok: true, value: order }
    } catch (error) {
      const apiError = toApiError(error)
      if (isRetryable(apiError)) {
        // It may have gone through on the server; show the real state.
        void get().fetchOrders()
      } else {
        // A definite answer (e.g. insufficient stock): the next attempt is a new order.
        set({ pendingAttempt: null })
      }
      refreshProducts()
      return { ok: false, status: apiError.status, message: apiError.message }
    } finally {
      set({ placing: false })
    }
  },

  cancelOrder: async (orderId) => {
    if (get().cancelling[orderId]) return IN_FLIGHT
    set((state) => ({ cancelling: { ...state.cancelling, [orderId]: true } }))

    try {
      // No automatic retry: a repeated cancel that already succeeded would come back as 409.
      const order = await api.cancelOrder(orderId)
      set((state) => ({ orders: upsert(state.orders, order) }))
      refreshProducts()
      return { ok: true, value: order }
    } catch (error) {
      const apiError = toApiError(error)
      // Already cancelled elsewhere, gone, or unknown outcome: reload to show the real status.
      void get().fetchOrders()
      refreshProducts()
      return { ok: false, status: apiError.status, message: apiError.message }
    } finally {
      set((state) => {
        const { [orderId]: _, ...rest } = state.cancelling
        return { cancelling: rest }
      })
    }
  },
}))
