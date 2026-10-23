import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { OrderForm } from './components/OrderForm'
import { OrdersList } from './components/OrdersList'
import { ProductList } from './components/ProductList'
import { useRefreshOnFocus } from './hooks/useRefreshOnFocus'
import { useOrdersStore } from './stores/ordersStore'
import { useProductsStore } from './stores/productsStore'

type Tab = 'shop' | 'orders'

export default function App() {
  const fetchProducts = useProductsStore((s) => s.fetchProducts)
  const fetchOrders = useOrdersStore((s) => s.fetchOrders)
  const orderCount = useOrdersStore((s) => s.orders.length)
  // Below lg the two columns become tabs, so each list keeps a usable height on phones.
  const [tab, setTab] = useState<Tab>('shop')

  // Data refreshes in place; the page itself never reloads.
  const refreshAll = useCallback(() => {
    void fetchProducts()
    void fetchOrders()
  }, [fetchProducts, fetchOrders])

  useEffect(refreshAll, [refreshAll])
  useRefreshOnFocus(refreshAll)

  const visibleOn = (which: Tab) => (tab === which ? 'flex' : 'hidden')

  return (
    // Fixed to the viewport: lists scroll inside their panels, the page never scrolls.
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-base font-semibold">Shop orders</h1>
        <nav aria-label="Sections" className="flex rounded-lg bg-slate-100 p-0.5 lg:hidden dark:bg-slate-800">
          <TabButton active={tab === 'shop'} onClick={() => setTab('shop')}>
            Shop
          </TabButton>
          <TabButton active={tab === 'orders'} onClick={() => setTab('orders')}>
            Orders{orderCount > 0 && <span className="ml-1 text-slate-500 dark:text-slate-400">{orderCount}</span>}
          </TabButton>
        </nav>
      </header>

      <main className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className={`${visibleOn('shop')} min-h-0 flex-col gap-4 lg:flex`}>
          <ProductList />
          <OrderForm />
        </div>
        <div className={`${visibleOn('orders')} min-h-0 flex-col lg:flex`}>
          <OrdersList />
        </div>
      </main>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md px-3 py-1 text-sm font-medium ${
        active
          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100'
          : 'text-slate-600 dark:text-slate-300'
      }`}
    >
      {children}
    </button>
  )
}
