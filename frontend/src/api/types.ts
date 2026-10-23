// Mirrors backend/app/schemas.py.

export interface Product {
  id: string
  name: string
  price: number
  stock: number
}

export type OrderStatus = 'placed' | 'cancelled'

export interface Order {
  id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  total_price: number
  customer_name: string
  status: OrderStatus
  created_at: string
  cancelled_at: string | null
}

export interface OrderInput {
  product_id: string
  quantity: number
  customer_name: string
}
