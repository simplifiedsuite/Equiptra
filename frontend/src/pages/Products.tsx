import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { Asset, ProductListItem } from '../types'
import { CategoryChips } from '../components/CategoryChips'
import { ProductThumbnail } from '../components/ProductThumbnail'
import { ProductFormModal } from '../components/ProductFormModal'
import { ScanButton } from '../components/ScanButton'
import { SearchIcon, PlusIcon } from '../components/icons'

function availabilityClass(available: number, total: number) {
  if (total === 0) return 'bg-[#EDEBE4] text-ink-soft'
  if (available === 0) return 'bg-red-fill text-red'
  if (available < total) return 'bg-amber-fill text-amber'
  return 'bg-teal-fill text-teal'
}

export function Products() {
  const [products, setProducts] = useState<ProductListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [scanError, setScanError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timeout = setTimeout(async () => {
      const term = search.trim()

      // A specific asset number or serial number should deep-link straight
      // to that unit's product, not just filter the grouped list by name.
      if (term.length >= 3) {
        try {
          const matches = await api.get<Asset[]>(`/assets?search=${encodeURIComponent(term)}`)
          const exact = matches.find(
            (a) =>
              a.asset_number?.toLowerCase() === term.toLowerCase() ||
              a.serial_number?.toLowerCase() === term.toLowerCase(),
          )
          if (exact && !cancelled) {
            navigate(`/products/${exact.product_id}?highlight=${exact.id}`)
            return
          }
        } catch {
          // fall through to a normal product search
        }
      }

      const params = new URLSearchParams()
      if (term) params.set('search', term)
      if (category) params.set('category', category)
      api
        .get<ProductListItem[]>(`/products?${params.toString()}`)
        .then((results) => !cancelled && setProducts(results))
        .catch(() => {})
        .finally(() => !cancelled && setLoading(false))
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [search, category, navigate, refreshKey])

  const subtitle = useMemo(() => {
    if (loading) return 'Loading…'
    return `${products.length} product${products.length === 1 ? '' : 's'}${category ? ` in ${category}` : ''} · LDMtv store`
  }, [products.length, category, loading])

  return (
    <div>
      <div className="mb-5.5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-[21px] font-bold">Products</h1>
          <p className="mt-1 text-[13px] text-ink-soft">{subtitle}</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 rounded-control bg-teal px-4 py-2.25 text-[13px] font-medium text-white hover:opacity-90"
        >
          <PlusIcon className="h-4 w-4" />
          New product
        </button>
      </div>

      <div className="mb-4.5 flex gap-2">
        <div className="flex max-w-[420px] flex-1 items-center gap-2 rounded-control border border-border bg-surface px-3.5 py-2.25">
          <SearchIcon className="h-4 w-4 shrink-0 text-ink-soft" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product, asset number, or serial…"
            className="w-full bg-transparent text-[13.5px] outline-none"
          />
        </div>
        <ScanButton onScanned={setSearch} onError={setScanError} label="Scan tag" />
      </div>

      {scanError && (
        <div className="mb-4.5 -mt-2.5 rounded-control border border-red-fill bg-red-fill px-3.5 py-2.5 text-[12.5px] font-medium text-red">
          {scanError}
        </div>
      )}

      <div className="mb-5">
        <CategoryChips active={category} onChange={setCategory} />
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
        {products.map((product) => (
          <button
            key={product.id}
            onClick={() => navigate(`/products/${product.id}`)}
            className="rounded-card border border-border bg-surface p-3.5 px-4 text-left transition-colors hover:border-border-strong"
          >
            <div className="mb-2.5 flex items-start gap-3">
              <ProductThumbnail url={product.image_url} size="card" />
              <div>
                <div className="mb-0.5 text-[14px] font-semibold leading-tight">{product.name}</div>
                <div className="text-[12px] text-ink-soft">{product.category}</div>
              </div>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-ink-soft">{product.manufacturer || '—'}</span>
              <span
                className={`rounded-full px-2.25 py-[3px] text-[11px] font-semibold ${availabilityClass(product.available_units, product.total_units)}`}
              >
                {product.available_units} of {product.total_units} available
              </span>
            </div>
          </button>
        ))}
      </div>

      {!loading && products.length === 0 && (
        <div className="mt-10 text-center text-[13px] text-ink-soft">No products match your search.</div>
      )}

      {showNew && (
        <ProductFormModal
          onClose={() => setShowNew(false)}
          onSaved={() => {
            setShowNew(false)
            setRefreshKey((k) => k + 1)
          }}
        />
      )}
    </div>
  )
}
