import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { ContractPicker } from '../components/ProjectFormModal'
import type { ContractDefault, ContractWithDefaults, CoreClient, ProductListItem } from '../types'

const fieldClass = 'rounded-control border border-border px-3.5 py-2.25 text-[13.5px] outline-none focus:border-teal'

// Contract defaults — a starting-point kit/equipment template for a Core
// Contract, applied to a new Project's booking_requests when it's created
// under that Contract (see CreateProject/applyContractDefaults,
// server-side). Purely a template: editing/removing defaults here never
// touches Projects already created from them. Two-step picker (Client,
// then Contract) since Core's own /api/contracts requires a client_id —
// same reasoning ContractPicker itself already documents. "Contracts with
// defaults set" lets a user jump straight back into one without
// re-picking client+contract.
export function ContractDefaults() {
  const [contractsWithDefaults, setContractsWithDefaults] = useState<ContractWithDefaults[]>([])
  const [coreClients, setCoreClients] = useState<CoreClient[]>([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedContract, setSelectedContract] = useState<{ id: string; name: string } | undefined>(undefined)
  const [defaults, setDefaults] = useState<ContractDefault[] | undefined>(undefined)
  const [editingId, setEditingId] = useState<number | undefined>(undefined)
  const [editingQty, setEditingQty] = useState('1')
  const [productSearch, setProductSearch] = useState('')
  const [productCandidates, setProductCandidates] = useState<ProductListItem[]>([])
  const [addingProduct, setAddingProduct] = useState<ProductListItem | undefined>(undefined)
  const [addingQty, setAddingQty] = useState('1')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  function reloadContractsWithDefaults() {
    api.get<ContractWithDefaults[]>('/contract-defaults/contracts').then(setContractsWithDefaults)
  }
  useEffect(reloadContractsWithDefaults, [])

  useEffect(() => {
    api
      .get<CoreClient[]>('/core-clients')
      .then(setCoreClients)
      .catch(() => {})
  }, [])

  function reloadDefaults(contractId: string) {
    api.get<ContractDefault[]>(`/contract-defaults?shared_contract_id=${encodeURIComponent(contractId)}`).then(setDefaults)
  }

  useEffect(() => {
    if (selectedContract) reloadDefaults(selectedContract.id)
  }, [selectedContract])

  // Debounced product search, same shape as Products.tsx's own list search.
  useEffect(() => {
    if (productSearch.trim().length < 2) {
      setProductCandidates([])
      return
    }
    const t = setTimeout(() => {
      api.get<ProductListItem[]>(`/products?search=${encodeURIComponent(productSearch.trim())}`).then(setProductCandidates)
    }, 200)
    return () => clearTimeout(t)
  }, [productSearch])

  function chooseExisting(c: ContractWithDefaults) {
    setSelectedContract({ id: c.shared_contract_id, name: c.shared_contract_name })
    setDefaults(undefined)
  }

  function changeContract() {
    setSelectedContract(undefined)
    setSelectedClientId('')
    setDefaults(undefined)
    setEditingId(undefined)
    setAddingProduct(undefined)
    setProductSearch('')
  }

  async function addDefault() {
    if (!selectedContract || !addingProduct) return
    setSaving(true)
    setError(undefined)
    try {
      await api.post('/contract-defaults', {
        shared_contract_id: selectedContract.id,
        shared_contract_name: selectedContract.name,
        product_id: addingProduct.id,
        quantity: Number(addingQty) || 1,
      })
      setAddingProduct(undefined)
      setAddingQty('1')
      setProductSearch('')
      setProductCandidates([])
      reloadDefaults(selectedContract.id)
      reloadContractsWithDefaults()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that default.')
    } finally {
      setSaving(false)
    }
  }

  async function saveQuantity(d: ContractDefault) {
    if (!selectedContract) return
    setSaving(true)
    setError(undefined)
    try {
      await api.post('/contract-defaults', {
        shared_contract_id: selectedContract.id,
        shared_contract_name: selectedContract.name,
        product_id: d.product_id,
        quantity: Number(editingQty) || 1,
      })
      setEditingId(undefined)
      reloadDefaults(selectedContract.id)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that default.')
    } finally {
      setSaving(false)
    }
  }

  async function removeDefault(id: number) {
    if (!selectedContract) return
    await api.delete(`/contract-defaults/${id}`)
    reloadDefaults(selectedContract.id)
    reloadContractsWithDefaults()
  }

  return (
    <div>
      <div className="mb-5.5">
        <h1 className="text-[21px] font-bold">Contract defaults</h1>
        <p className="mt-1 text-[13px] text-ink-soft">
          A starting-point set of kit applied to a new Project created under a Contract — fully editable on that Project afterward, and changing these later never affects Projects already created.
        </p>
      </div>

      {!selectedContract && contractsWithDefaults.length > 0 && (
        <div className="mb-5 max-w-[520px]">
          <div className="mb-1.5 text-[11.5px] font-medium text-ink-soft">Contracts with defaults set</div>
          <div className="flex flex-col gap-1.5">
            {contractsWithDefaults.map((c) => (
              <button
                key={c.shared_contract_id}
                onClick={() => chooseExisting(c)}
                className="flex items-center justify-between rounded-control border border-border bg-surface px-3.5 py-2.5 text-left text-[13.5px] hover:border-teal"
              >
                <span className="font-semibold">{c.shared_contract_name}</span>
                <span className="text-[12.5px] text-ink-soft">
                  {c.default_count} product{c.default_count === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!selectedContract && (
        <div className="flex max-w-[420px] flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Client
            <select value={selectedClientId} onChange={(e) => setSelectedClientId(e.target.value)} className={fieldClass}>
              <option value="">Select a client…</option>
              {coreClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {selectedClientId && (
            <ContractPicker key={selectedClientId} coreClientId={selectedClientId} value={undefined} onChange={(c) => c && setSelectedContract(c)} />
          )}
        </div>
      )}

      {selectedContract && (
        <div className="max-w-[560px]">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[15px] font-bold">{selectedContract.name}</span>
            <button onClick={changeContract} className="rounded-control border border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-soft hover:border-border-strong">
              Change contract
            </button>
          </div>

          {defaults === undefined ? (
            <div className="text-[13px] text-ink-soft">Loading…</div>
          ) : (
            <div className="mb-4 flex flex-col gap-2">
              {defaults.map((d) =>
                editingId === d.id ? (
                  <div key={d.id} className="flex items-center gap-2.5 rounded-control border border-border bg-surface px-3.5 py-2.5">
                    <div className="flex-1 text-[13.5px]">{d.product_name}</div>
                    <input
                      type="number"
                      min={1}
                      value={editingQty}
                      onChange={(e) => setEditingQty(e.target.value)}
                      className={`${fieldClass} w-16`}
                    />
                    <button onClick={() => setEditingId(undefined)} className="rounded-control border border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-soft">
                      Cancel
                    </button>
                    <button
                      onClick={() => saveQuantity(d)}
                      disabled={saving}
                      className="rounded-control bg-teal px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <div key={d.id} className="flex items-center gap-2.5 rounded-control border border-border bg-surface px-3.5 py-2.5">
                    <div className="flex-1 text-[13.5px]">
                      <span className="font-semibold">{d.product_name}</span>
                      {d.category && <span className="text-ink-soft"> · {d.category}</span>}
                      <span className="text-ink-soft"> · qty {d.quantity}</span>
                    </div>
                    <button
                      onClick={() => {
                        setEditingId(d.id)
                        setEditingQty(String(d.quantity))
                      }}
                      className="text-[12px] font-medium text-ink-soft hover:text-teal"
                    >
                      Edit
                    </button>
                    <button onClick={() => removeDefault(d.id)} className="text-[12px] font-medium text-ink-soft hover:text-red">
                      Remove
                    </button>
                  </div>
                ),
              )}
              {defaults.length === 0 && <div className="text-[13px] text-ink-soft">No kit defaults set for this Contract yet.</div>}
            </div>
          )}

          <div className="rounded-control border border-border bg-off-white p-3">
            {addingProduct ? (
              <div className="flex items-center gap-2.5">
                <div className="flex-1 text-[13px] font-medium">{addingProduct.name}</div>
                <input
                  type="number"
                  min={1}
                  value={addingQty}
                  onChange={(e) => setAddingQty(e.target.value)}
                  className={`${fieldClass} w-16`}
                />
                <button onClick={() => setAddingProduct(undefined)} className="rounded-control border border-border px-3 py-1.5 text-[12.5px] font-medium text-ink-soft">
                  Cancel
                </button>
                <button
                  onClick={addDefault}
                  disabled={saving}
                  className="rounded-control bg-teal px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60"
                >
                  Add
                </button>
              </div>
            ) : (
              <>
                <input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search products to add a default…"
                  className={`${fieldClass} w-full`}
                />
                {productCandidates.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {productCandidates
                      .filter((p) => !defaults?.some((d) => d.product_id === p.id))
                      .map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setAddingProduct(p)
                            setProductCandidates([])
                          }}
                          className="rounded-control border border-border px-2.5 py-1.5 text-[12px] font-medium text-ink-soft hover:border-border-strong"
                        >
                          {p.name} {p.category ? `· ${p.category}` : ''}
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
          {error && <div className="mt-2 text-[12px] font-medium text-red">{error}</div>}
        </div>
      )}
    </div>
  )
}
