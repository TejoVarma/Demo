import { afterEach, describe, expect, it, vi } from 'vitest'

import { headerOf, mockFetch } from '../test/fetchMock'
import { input } from '../test/fixtures'
import { ApiError, api, withRetry } from './client'

afterEach(() => {
  vi.useRealTimers()
})

describe('api client', () => {
  it('calls the backend through /api', async () => {
    const fetchMock = mockFetch({ status: 200, body: [] })
    await api.getProducts()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/products')
  })

  it('sends the idempotency key and JSON body when creating an order', async () => {
    const fetchMock = mockFetch({ status: 201, body: {} })
    await api.createOrder(input, 'key-123')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/orders')
    expect(init?.method).toBe('POST')
    expect(headerOf(init, 'Idempotency-Key')).toBe('key-123')
    expect(JSON.parse(String(init?.body))).toEqual(input)
  })

  it('uses the server message for business errors', async () => {
    mockFetch({ status: 409, body: { detail: 'Insufficient stock: only 1 left, requested 2' } })
    await expect(api.getOrders()).rejects.toEqual(new ApiError(409, 'Insufficient stock: only 1 left, requested 2'))
  })

  it('turns FastAPI validation errors into a readable message', async () => {
    mockFetch({
      status: 422,
      body: { detail: [{ loc: ['body', 'customer_name'], msg: 'String should have at most 60 characters' }] },
    })
    await expect(api.getOrders()).rejects.toMatchObject({
      status: 422,
      message: 'customer name: String should have at most 60 characters',
    })
  })

  it('reports network failures as status 0', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(api.getOrders()).rejects.toMatchObject({ status: 0 })
  })

  it('handles non-JSON error bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })))
    await expect(api.getOrders()).rejects.toMatchObject({ status: 502, message: 'Something went wrong, please try again' })
  })
})

describe('withRetry', () => {
  it('retries network errors and 5xx, then succeeds', async () => {
    vi.useFakeTimers()
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(0, 'offline'))
      .mockRejectedValueOnce(new ApiError(503, 'unavailable'))
      .mockResolvedValueOnce('done')

    const promise = withRetry(fn)
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toBe('done')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('does not retry 4xx answers', async () => {
    const fn = vi.fn().mockRejectedValue(new ApiError(409, 'Insufficient stock'))
    await expect(withRetry(fn)).rejects.toMatchObject({ status: 409 })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives up after the retry limit', async () => {
    vi.useFakeTimers()
    const fn = vi.fn().mockRejectedValue(new ApiError(500, 'boom'))

    const promise = withRetry(fn, { retries: 2 })
    const assertion = expect(promise).rejects.toMatchObject({ status: 500 })
    await vi.runAllTimersAsync()

    await assertion
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
