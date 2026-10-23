import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'

import { formatPrice } from '../lib/format'
import { useOrdersStore } from '../stores/ordersStore'
import { useProductsStore } from '../stores/productsStore'
import { Notice } from './Panel'

export const MAX_QUANTITY = 20
export const MAX_NAME_LENGTH = 60
export const SUCCESS_NOTICE_MS = 4000

interface FieldErrors {
  product?: string
  quantity?: string
  name?: string
}

// Same rules as the backend; the server still has the final say (stock can change meanwhile).
function validate(productId: string, stock: number | undefined, quantity: string, name: string): FieldErrors {
  const errors: FieldErrors = {}

  if (!productId) errors.product = 'Choose a product'
  else if (stock === 0) errors.product = 'This product is out of stock'

  if (!/^\d+$/.test(quantity.trim())) {
    errors.quantity = 'Enter a whole number'
  } else {
    const value = Number(quantity)
    if (value < 1) errors.quantity = 'Quantity must be at least 1'
    else if (value > MAX_QUANTITY) errors.quantity = `You can order at most ${MAX_QUANTITY} at a time`
    else if (stock !== undefined && value > stock) errors.quantity = `Only ${stock} in stock`
  }

  const trimmed = name.trim()
  if (!trimmed) errors.name = 'Customer name is required'
  else if (trimmed.length > MAX_NAME_LENGTH) errors.name = `Use at most ${MAX_NAME_LENGTH} characters`

  return errors
}

const inputClass =
  'mt-1 block w-full rounded-lg border bg-white px-3 py-2 text-sm shadow-xs outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 dark:bg-slate-950 aria-invalid:border-red-500 border-slate-300 dark:border-slate-700'

export function OrderForm() {
  const id = useId()
  const products = useProductsStore((s) => s.products)
  const placeOrder = useOrdersStore((s) => s.placeOrder)
  const placing = useOrdersStore((s) => s.placing)

  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [name, setName] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  const product = products.find((p) => p.id === productId)
  const errors = validate(productId, product?.stock, quantity, name)
  const hasErrors = Object.keys(errors).length > 0
  const show = (field: keyof FieldErrors) => (submitted ? errors[field] : undefined)
  const trimmedLength = name.trim().length

  // Success fades on its own; errors stay until the user edits the form or submits again.
  useEffect(() => {
    if (result?.tone !== 'success') return
    const timer = setTimeout(() => setResult(null), SUCCESS_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [result])

  // Editing any field starts a new attempt, so the previous outcome no longer applies.
  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value)
    setResult(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    setResult(null)
    if (hasErrors || placing) return

    const outcome = await placeOrder({ product_id: productId, quantity: Number(quantity), customer_name: name.trim() })
    if (outcome.ok) {
      const order = outcome.value
      setResult({
        tone: 'success',
        message: `Order placed: ${order.quantity} × ${order.product_name} for ${formatPrice(order.total_price)}`,
      })
      setProductId('')
      setQuantity('1')
      setName('')
      setSubmitted(false)
    } else if (!outcome.skipped) {
      setResult({ tone: 'error', message: outcome.message })
    }
  }

  return (
    <section
      aria-label="Place an order"
      className="shrink-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <h2 className="text-sm font-semibold">Place an order</h2>

      <form noValidate onSubmit={handleSubmit} className="mt-3 grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
        <Field id={`${id}-product`} label="Product" error={show('product')} className="col-span-2">
          <select
            id={`${id}-product`}
            value={productId}
            onChange={(e) => edit(setProductId)(e.target.value)}
            disabled={placing}
            {...errorProps(`${id}-product`, show('product'))}
            className={inputClass}
          >
            <option value="">Select a product</option>
            {products.map((p) => (
              <option key={p.id} value={p.id} disabled={p.stock === 0}>
                {p.name} — {formatPrice(p.price)} ({p.stock === 0 ? 'out of stock' : `${p.stock} in stock`})
              </option>
            ))}
          </select>
        </Field>

        <Field
          id={`${id}-name`}
          label="Customer name"
          error={show('name')}
          hint={
            <span className={trimmedLength > MAX_NAME_LENGTH ? 'text-red-600 dark:text-red-400' : undefined}>
              {trimmedLength}/{MAX_NAME_LENGTH}
            </span>
          }
        >
          <input
            id={`${id}-name`}
            type="text"
            value={name}
            onChange={(e) => edit(setName)(e.target.value)}
            disabled={placing}
            autoComplete="name"
            {...errorProps(`${id}-name`, show('name'))}
            className={inputClass}
          />
        </Field>

        <Field id={`${id}-quantity`} label="Quantity" error={show('quantity')}>
          <input
            id={`${id}-quantity`}
            type="number"
            inputMode="numeric"
            min={1}
            max={Math.min(MAX_QUANTITY, product?.stock ?? MAX_QUANTITY) || 1}
            step={1}
            value={quantity}
            onChange={(e) => edit(setQuantity)(e.target.value)}
            disabled={placing}
            {...errorProps(`${id}-quantity`, show('quantity'))}
            className={inputClass}
          />
        </Field>

        <div className="col-span-2 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-600 tabular-nums dark:text-slate-300">
            {product && !errors.quantity ? <>Total: {formatPrice(product.price * Number(quantity))}</> : ' '}
          </p>
          <button
            type="submit"
            disabled={placing}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {placing ? 'Placing order…' : 'Place order'}
          </button>
        </div>
      </form>

      {result && (
        <div className="mt-3">
          <Notice tone={result.tone}>{result.message}</Notice>
        </div>
      )}
    </section>
  )
}

function errorProps(fieldId: string, error: string | undefined) {
  return { 'aria-invalid': !!error, 'aria-describedby': error ? `${fieldId}-error` : undefined }
}

interface FieldProps {
  id: string
  label: string
  error?: string
  hint?: ReactNode
  className?: string
  children: ReactNode
}

// The label holds only the field name, so the control's accessible name stays clean;
// the error is linked with aria-describedby.
function Field({ id, label, error, hint, className = '', children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {(error || hint) && (
        <div className="mt-1 flex gap-2 text-xs">
          {error && (
            <span id={`${id}-error`} className="text-red-600 dark:text-red-400">
              {error}
            </span>
          )}
          {hint && <span className="ml-auto text-slate-500 tabular-nums dark:text-slate-400">{hint}</span>}
        </div>
      )}
    </div>
  )
}
