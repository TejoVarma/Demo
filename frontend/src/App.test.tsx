import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import App from './App'
import { initialOrdersState, useOrdersStore } from './stores/ordersStore'
import { initialProductsState, useProductsStore } from './stores/productsStore'
import { mockFetchByRoute } from './test/fetchMock'
import { makeOrder, notebook } from './test/fixtures'

beforeEach(() => {
  useOrdersStore.setState(initialOrdersState)
  useProductsStore.setState(initialProductsState)
})

describe('App', () => {
  it('loads products and orders on start', async () => {
    mockFetchByRoute({
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
      'GET /api/orders': () => ({ status: 200, body: [makeOrder()] }),
    })
    render(<App />)

    expect(await screen.findByText('10 in stock')).toBeInTheDocument()
    expect(await screen.findByText('Asha · ', { exact: false })).toBeInTheDocument()
  })

  it('refreshes data in place when the window regains focus', async () => {
    let stock = 10
    const fetchMock = mockFetchByRoute({
      'GET /api/products': () => ({ status: 200, body: [{ ...notebook, stock }] }),
      'GET /api/orders': () => ({ status: 200, body: [] }),
    })
    render(<App />)
    expect(await screen.findByText('10 in stock')).toBeInTheDocument()

    stock = 7
    window.dispatchEvent(new Event('focus'))

    expect(await screen.findByText('7 in stock')).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/products')).toHaveLength(2)
  })

  it('switches between the Shop and Orders sections on small screens', async () => {
    mockFetchByRoute({
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
      'GET /api/orders': () => ({ status: 200, body: [makeOrder()] }),
    })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(useOrdersStore.getState().loaded).toBe(true))

    const shop = screen.getByRole('region', { name: 'Products' }).parentElement!
    const orders = screen.getByRole('region', { name: 'Orders' }).parentElement!
    expect(shop).toHaveClass('flex')
    expect(orders).toHaveClass('hidden')

    await user.click(screen.getByRole('button', { name: /Orders/ }))

    expect(shop).toHaveClass('hidden')
    expect(orders).toHaveClass('flex')
    expect(screen.getByRole('button', { name: /Orders/ })).toHaveAttribute('aria-pressed', 'true')
  })
})
