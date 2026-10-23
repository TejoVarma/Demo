import { formatPrice } from '../lib/format'
import { useProductsStore } from '../stores/productsStore'
import { EmptyState, Notice, Panel, RefreshButton } from './Panel'

export function ProductList() {
  const { products, loaded, loading, error, fetchProducts } = useProductsStore()

  return (
    <Panel
      title="Products"
      subtitle={loaded ? `${products.length} products` : undefined}
      actions={<RefreshButton onClick={() => void fetchProducts()} loading={loading} />}
      className="flex-1"
    >
      {error && (
        <div className="p-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {!loaded && !error && <EmptyState>Loading products…</EmptyState>}
      {loaded && products.length === 0 && <EmptyState>No products yet.</EmptyState>}

      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {products.map((product) => (
          <li key={product.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{product.name}</p>
              <p className="text-sm text-slate-500 tabular-nums dark:text-slate-400">{formatPrice(product.price)}</p>
            </div>
            <StockBadge stock={product.stock} />
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) {
    return (
      <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
        Out of stock
      </span>
    )
  }
  const low = stock <= 5
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums ${
        low
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
      {stock} in stock
    </span>
  )
}
