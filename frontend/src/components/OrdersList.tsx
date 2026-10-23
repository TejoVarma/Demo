import { useState } from 'react'

import type { Order } from '../api/types'
import { formatDateTime, formatPrice } from '../lib/format'
import { useOrdersStore } from '../stores/ordersStore'
import { EmptyState, Notice, Panel, RefreshButton } from './Panel'

export function OrdersList() {
  const { orders, loaded, loading, error, fetchOrders } = useOrdersStore()
  const [actionError, setActionError] = useState<string | null>(null)

  return (
    <Panel
      title="Orders"
      subtitle={loaded ? `${orders.length} orders · newest first` : undefined}
      actions={<RefreshButton onClick={() => void fetchOrders()} loading={loading} />}
      className="flex-1"
    >
      {(error || actionError) && (
        <div className="space-y-2 p-3">
          {actionError && <Notice tone="error">{actionError}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
      {!loaded && !error && <EmptyState>Loading orders…</EmptyState>}
      {loaded && orders.length === 0 && <EmptyState>No orders yet. Place one to see it here.</EmptyState>}

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {orders.map((order) => (
          <OrderRow key={order.id} order={order} onError={setActionError} />
        ))}
      </ul>
    </Panel>
  )
}

function OrderRow({ order, onError }: { order: Order; onError: (message: string | null) => void }) {
  const cancelOrder = useOrdersStore((s) => s.cancelOrder)
  const cancelling = useOrdersStore((s) => !!s.cancelling[order.id])
  const [confirming, setConfirming] = useState(false)
  const cancelled = order.status === 'cancelled'

  async function handleCancel() {
    onError(null)
    const outcome = await cancelOrder(order.id)
    setConfirming(false)
    if (!outcome.ok && !outcome.skipped) onError(outcome.message)
  }

  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${cancelled ? 'opacity-60' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {order.product_name} <span className="text-slate-500 dark:text-slate-400">× {order.quantity}</span>
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {order.customer_name} · {formatDateTime(order.created_at)}
        </p>
      </div>

      <p className={`text-sm font-semibold tabular-nums ${cancelled ? 'line-through' : ''}`}>
        {formatPrice(order.total_price)}
      </p>

      <StatusBadge cancelled={cancelled} />

      <div className="flex w-36 justify-end">
        {!cancelled &&
          (confirming ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={cancelling}
                className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
              >
                {cancelling ? 'Cancelling…' : 'Yes, cancel'}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={cancelling}
                className="rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Cancel order
            </button>
          ))}
      </div>
    </li>
  )
}

function StatusBadge({ cancelled }: { cancelled: boolean }) {
  return cancelled ? (
    <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
      Cancelled
    </span>
  ) : (
    <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      Placed
    </span>
  )
}
