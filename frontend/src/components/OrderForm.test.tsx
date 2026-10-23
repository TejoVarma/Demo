import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initialOrdersState, useOrdersStore } from '../stores/ordersStore'
import { initialProductsState, useProductsStore } from '../stores/productsStore'
import { mockFetchByRoute } from '../test/fetchMock'
import { makeOrder, notebook, pen } from '../test/fixtures'
import { OrderForm, SUCCESS_NOTICE_MS } from './OrderForm'

afterEach(() => {
  vi.useRealTimers()
})

beforeEach(() => {
  useOrdersStore.setState(initialOrdersState)
  useProductsStore.setState({ ...initialProductsState, products: [notebook, pen], loaded: true })
})

async function fillForm(user: ReturnType<typeof userEvent.setup>, { quantity = '2', name = 'Asha' } = {}) {
  await user.selectOptions(screen.getByLabelText('Product'), notebook.id)
  await user.clear(screen.getByLabelText('Quantity'))
  if (quantity) await user.type(screen.getByLabelText('Quantity'), quantity)
  if (name) await user.type(screen.getByLabelText('Customer name'), name)
}

describe('OrderForm', () => {
  it('disables out-of-stock products', () => {
    render(<OrderForm />)
    expect(screen.getByRole('option', { name: /Pen/ })).toBeDisabled()
    expect(screen.getByRole('option', { name: /Notebook/ })).toBeEnabled()
  })

  it('shows validation errors and sends nothing', async () => {
    const fetchMock = mockFetchByRoute({})
    const user = userEvent.setup()
    render(<OrderForm />)

    await user.click(screen.getByRole('button', { name: 'Place order' }))

    expect(screen.getByText('Choose a product')).toBeInTheDocument()
    expect(screen.getByText('Customer name is required')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['0', 'Quantity must be at least 1'],
    ['21', 'You can order at most 20 at a time'],
    ['11', 'Only 10 in stock'],
  ])('rejects quantity %s', async (quantity, message) => {
    mockFetchByRoute({})
    const user = userEvent.setup()
    render(<OrderForm />)

    await fillForm(user, { quantity })
    await user.click(screen.getByRole('button', { name: 'Place order' }))

    expect(screen.getByText(message)).toBeInTheDocument()
  })

  it('rejects names longer than 60 characters', async () => {
    mockFetchByRoute({})
    const user = userEvent.setup()
    render(<OrderForm />)

    await fillForm(user, { name: 'a'.repeat(61) })
    await user.click(screen.getByRole('button', { name: 'Place order' }))

    expect(screen.getByText('Use at most 60 characters')).toBeInTheDocument()
  })

  it('places an order, shows a confirmation and resets the form', async () => {
    const fetchMock = mockFetchByRoute({
      'POST /api/orders': () => ({ status: 201, body: makeOrder() }),
      'GET /api/products': () => ({ status: 200, body: [{ ...notebook, stock: 8 }, pen] }),
    })
    const user = userEvent.setup()
    render(<OrderForm />)

    await fillForm(user)
    expect(screen.getByText(/Total: ₹100\.00/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Place order' }))

    expect(await screen.findByText('Order placed: 2 × Notebook for ₹100.00')).toBeInTheDocument()
    expect(screen.getByLabelText('Customer name')).toHaveValue('')
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]?.body))).toEqual({ product_id: notebook.id, quantity: 2, customer_name: 'Asha' })
  })

  it('disables the button while the order is being placed', async () => {
    let release: () => void = () => {}
    mockFetchByRoute({
      'POST /api/orders': () => ({ status: 201, body: makeOrder() }),
      'GET /api/products': () => ({ status: 200, body: [notebook, pen] }),
    })
    const user = userEvent.setup()
    render(<OrderForm />)
    await fillForm(user)

    const fetchMock = globalThis.fetch as ReturnType<typeof mockFetchByRoute>
    const realFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (release = resolve))
      return realFetch(...args)
    })

    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(screen.getByRole('button', { name: 'Placing order…' })).toBeDisabled()

    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Place order' })).toBeEnabled())
  })

  it('shows the server message when stock ran out meanwhile', async () => {
    mockFetchByRoute({
      'POST /api/orders': () => ({ status: 409, body: { detail: 'Insufficient stock: only 1 left, requested 2' } }),
      'GET /api/products': () => ({ status: 200, body: [{ ...notebook, stock: 1 }, pen] }),
    })
    const user = userEvent.setup()
    render(<OrderForm />)

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Place order' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient stock: only 1 left, requested 2')
    // Form keeps its values so the user can adjust the quantity.
    expect(screen.getByLabelText('Customer name')).toHaveValue('Asha')
  })

  it('hides the success message after a few seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetchByRoute({
      'POST /api/orders': () => ({ status: 201, body: makeOrder() }),
      'GET /api/products': () => ({ status: 200, body: [notebook, pen] }),
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<OrderForm />)

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Order placed')

    await act(() => vi.advanceTimersByTimeAsync(SUCCESS_NOTICE_MS))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('clears the success message as soon as the next order is started', async () => {
    mockFetchByRoute({
      'POST /api/orders': () => ({ status: 201, body: makeOrder() }),
      'GET /api/products': () => ({ status: 200, body: [notebook, pen] }),
    })
    const user = userEvent.setup()
    render(<OrderForm />)

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(await screen.findByRole('status')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Customer name'), 'R')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps an error message until the user edits the form', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockFetchByRoute({
      'POST /api/orders': () => ({ status: 409, body: { detail: 'Insufficient stock: only 1 left, requested 2' } }),
      'GET /api/products': () => ({ status: 200, body: [notebook, pen] }),
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<OrderForm />)

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Place order' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(SUCCESS_NOTICE_MS * 2))
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Quantity'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
