import { create } from 'zustand'

import { api, toApiError } from '../api/client'
import type { Product } from '../api/types'

interface ProductsState {
  products: Product[]
  loaded: boolean
  loading: boolean
  error: string | null
  fetchProducts: () => Promise<void>
}

export const initialProductsState = {
  products: [],
  loaded: false,
  loading: false,
  error: null,
} satisfies Partial<ProductsState>

// Overlapping refreshes (after an order, on focus) can resolve out of order; only the latest wins.
let latestRequest = 0

export const useProductsStore = create<ProductsState>()((set) => ({
  ...initialProductsState,

  fetchProducts: async () => {
    const requestId = ++latestRequest
    set({ loading: true })
    try {
      const products = await api.getProducts()
      if (requestId !== latestRequest) return
      set({ products, loaded: true, loading: false, error: null })
    } catch (error) {
      if (requestId !== latestRequest) return
      // Keep showing the last good list; just surface the error.
      set({ loading: false, error: toApiError(error).message })
    }
  },
}))
