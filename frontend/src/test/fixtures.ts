import type { Order, OrderInput, Product } from '../api/types'

export const notebook: Product = { id: 'p-notebook', name: 'Notebook', price: 50, stock: 10 }
export const pen: Product = { id: 'p-pen', name: 'Pen', price: 20, stock: 0 }

export const input: OrderInput = { product_id: notebook.id, quantity: 2, customer_name: 'Asha' }

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o-1',
    product_id: notebook.id,
    product_name: notebook.name,
    quantity: 2,
    unit_price: 50,
    total_price: 100,
    customer_name: 'Asha',
    status: 'placed',
    created_at: '2026-10-23T10:00:00+00:00',
    cancelled_at: null,
    ...overrides,
  }
}
