import { vi } from 'vitest'

type Reply = { status: number; body?: unknown } | Error

/**
 * Stubs global fetch with a queue of replies (an Error simulates a network failure).
 * Returns the mock so tests can inspect the calls.
 */
export function mockFetch(...replies: Reply[]) {
  const queue = [...replies]
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const reply = queue.shift()
    if (!reply) throw new Error('Unexpected fetch: no reply queued')
    if (reply instanceof Error) throw reply
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Like mockFetch, but routes by URL so background refreshes don't consume the main replies. */
export function mockFetchByRoute(routes: Record<string, () => Reply>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const route = Object.entries(routes).find(([pattern]) => key.startsWith(pattern))
    if (!route) throw new Error(`Unexpected fetch: ${key}`)
    const reply = route[1]()
    if (reply instanceof Error) throw reply
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name]
}
