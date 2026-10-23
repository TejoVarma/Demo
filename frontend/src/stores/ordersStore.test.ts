import { beforeEach, describe, expect, it, vi } from 'vitest'

import { headerOf, mockFetchByRoute } from '../test/fetchMock'
import { input, makeOrder, notebook } from '../test/fixtures'
import { initialOrdersState, useOrdersStore } from './ordersStore'
import { initialProductsState, useProductsStore } from './productsStore'

const orderKeys = (fetchMock: ReturnType<typeof mockFetchByRoute>) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/orders' && init?.method === 'POST')
    .map(([, init]) => headerOf(init, 'Idempotency-Key'))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  useOrdersStore.setState(initialOrdersState)
  useProductsStore.setState(initialProductsState)
})

describe('placeOrder', () => {
  it('adds the new order and refreshes product stock', async () => {
    const order = makeOrder()
    const fetchMock = mockFetchByRoute({
      'POST /api/orders': () => ({ status: 201, body: order }),
      'GET /api/products': () => ({ status: 200, body: [{ ...notebook, stock: 8 }] }),
    })

    const result = await useOrdersStore.getState().placeOrder(input)
    await flush()

    expect(result).toEqual({ ok: true, value: order })
    expect(useOrdersStore.getState().orders).toEqual([order])
    expect(useOrdersStore.getState().pendingAttempt).toBeNull()
    expect(useProductsStore.getState().products[0].stock).toBe(8)
    expect(orderKeys(fetchMock)).toHaveLength(1)
  })

  it('ignores a second call while the first is in flight (double click)', async () => {
    let release: () => void = () => {}
    const fetchMock = mockFetchByRoute({
      'POST /api/orders': () => ({ status: 201, body: makeOrder() }),
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
    })
    const realFetch = fetchMock.getMockImplementation()!
    fetchMock.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (release = resolve))
      return realFetch(...args)
    })

    const first = useOrdersStore.getState().placeOrder(input)
    const second = await useOrdersStore.getState().placeOrder(input)
    release()
    await first

    expect(second).toMatchObject({ ok: false, skipped: true })
    expect(orderKeys(fetchMock)).toHaveLength(1)
  })

  it('retries a failed request with the same idempotency key', async () => {
    vi.useFakeTimers()
    const replies = [{ status: 503 }, { status: 502 }, { status: 201, body: makeOrder() }]
    const fetchMock = mockFetchByRoute({
      'POST /api/orders': () => replies.shift()!,
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
    })

    const promise = useOrdersStore.getState().placeOrder(input)
    await vi.runAllTimersAsync()
    const result = await promise
    vi.useRealTimers()

    expect(result.ok).toBe(true)
    const keys = orderKeys(fetchMock)
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
  })

  it('reuses the key when the same order is resubmitted after an unknown outcome', async () => {
    vi.useFakeTimers()
    let fail = true
    const fetchMock = mockFetchByRoute({
      'POST /api/orders': () => (fail ? new TypeError('Failed to fetch') : { status: 200, body: makeOrder() }),
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
      'GET /api/orders': () => ({ status: 200, body: [] }),
    })

    const firstAttempt = useOrdersStore.getState().placeOrder(input)
    await vi.runAllTimersAsync()
    expect((await firstAttempt).ok).toBe(false)
    expect(useOrdersStore.getState().pendingAttempt).not.toBeNull()

    fail = false
    const retry = useOrdersStore.getState().placeOrder({ ...input, customer_name: '  Asha ' })
    await vi.runAllTimersAsync()
    expect((await retry).ok).toBe(true)
    vi.useRealTimers()

    expect(new Set(orderKeys(fetchMock)).size).toBe(1)
  })

  it('uses a new key when the order details change after a failure', async () => {
    vi.useFakeTimers()
    let fail = true
    const fetchMock = mockFetchByRoute({
      'POST /api/orders': () => (fail ? { status: 500 } : { status: 201, body: makeOrder({ quantity: 3 }) }),
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
      'GET /api/orders': () => ({ status: 200, body: [] }),
    })

    const firstAttempt = useOrdersStore.getState().placeOrder(input)
    await vi.runAllTimersAsync()
    await firstAttempt
    fail = false
    const changed = useOrdersStore.getState().placeOrder({ ...input, quantity: 3 })
    await vi.runAllTimersAsync()
    await changed
    vi.useRealTimers()

    const keys = orderKeys(fetchMock)
    expect(keys.at(0)).not.toBe(keys.at(-1))
  })

  it('drops the key after a definite rejection and refreshes stock', async () => {
    const fetchMock = mockFetchByRoute({
      'POST /api/orders': () => ({ status: 409, body: { detail: 'Insufficient stock: only 1 left, requested 2' } }),
      'GET /api/products': () => ({ status: 200, body: [{ ...notebook, stock: 1 }] }),
    })

    const result = await useOrdersStore.getState().placeOrder(input)
    await useOrdersStore.getState().placeOrder(input)
    await flush()

    expect(result).toEqual({ ok: false, status: 409, message: 'Insufficient stock: only 1 left, requested 2' })
    expect(useOrdersStore.getState().pendingAttempt).toBeNull()
    const keys = orderKeys(fetchMock)
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
    expect(useProductsStore.getState().products[0].stock).toBe(1)
  })

  it('shows the real state after an unknown outcome', async () => {
    vi.useFakeTimers()
    const saved = makeOrder()
    mockFetchByRoute({
      'POST /api/orders': () => ({ status: 504 }),
      'GET /api/orders': () => ({ status: 200, body: [saved] }),
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
    })

    const promise = useOrdersStore.getState().placeOrder(input)
    await vi.runAllTimersAsync()
    await promise
    vi.useRealTimers()
    await flush()

    // The request may have succeeded on the server; the list reflects what was saved.
    expect(useOrdersStore.getState().orders).toEqual([saved])
  })
})

describe('cancelOrder', () => {
  it('marks the order cancelled and refreshes stock', async () => {
    const placed = makeOrder()
    useOrdersStore.setState({ orders: [placed], loaded: true })
    const fetchMock = mockFetchByRoute({
      'POST /api/orders/o-1/cancel': () => ({ status: 200, body: { ...placed, status: 'cancelled' } }),
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
    })

    const result = await useOrdersStore.getState().cancelOrder('o-1')
    await flush()

    expect(result.ok).toBe(true)
    expect(useOrdersStore.getState().orders[0].status).toBe('cancelled')
    expect(useOrdersStore.getState().cancelling).toEqual({})
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/products')).toBe(true)
  })

  it('sends only one cancel while one is in flight', async () => {
    const fetchMock = mockFetchByRoute({
      'POST /api/orders/o-1/cancel': () => ({ status: 200, body: makeOrder({ status: 'cancelled' }) }),
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
    })

    const [first, second] = await Promise.all([
      useOrdersStore.getState().cancelOrder('o-1'),
      useOrdersStore.getState().cancelOrder('o-1'),
    ])

    expect(first.ok).toBe(true)
    expect(second).toMatchObject({ ok: false, skipped: true })
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/cancel'))).toHaveLength(1)
  })

  it('reloads orders when the order was already cancelled elsewhere', async () => {
    useOrdersStore.setState({ orders: [makeOrder()], loaded: true })
    mockFetchByRoute({
      'POST /api/orders/o-1/cancel': () => ({ status: 409, body: { detail: 'Order is already cancelled' } }),
      'GET /api/orders': () => ({ status: 200, body: [makeOrder({ status: 'cancelled' })] }),
      'GET /api/products': () => ({ status: 200, body: [notebook] }),
    })

    const result = await useOrdersStore.getState().cancelOrder('o-1')
    await flush()

    expect(result).toEqual({ ok: false, status: 409, message: 'Order is already cancelled' })
    expect(useOrdersStore.getState().orders[0].status).toBe('cancelled')
  })
})

describe('fetchOrders', () => {
  it('ignores a slower, older response', async () => {
    const resolvers: ((r: Response) => void)[] = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => resolvers.push(resolve))))

    const older = useOrdersStore.getState().fetchOrders()
    const newer = useOrdersStore.getState().fetchOrders()
    resolvers[1](new Response(JSON.stringify([makeOrder({ id: 'new' })]), { status: 200 }))
    await newer
    resolvers[0](new Response(JSON.stringify([makeOrder({ id: 'old' })]), { status: 200 }))
    await older

    expect(useOrdersStore.getState().orders.map((o) => o.id)).toEqual(['new'])
  })

  it('keeps the last good list when a refresh fails', async () => {
    useOrdersStore.setState({ orders: [makeOrder()], loaded: true })
    mockFetchByRoute({ 'GET /api/orders': () => new TypeError('Failed to fetch') })

    await useOrdersStore.getState().fetchOrders()

    expect(useOrdersStore.getState().orders).toHaveLength(1)
    expect(useOrdersStore.getState().error).toMatch(/Could not reach the server/)
  })
})
