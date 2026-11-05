"use client"

import * as React from "react"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"

export type ColumnDef<T> = {
  header: string
  accessorKey?: keyof T
  cell?: (row: T) => React.ReactNode
  className?: string
}

type DataTableProps<T> = {
  columns: ColumnDef<T>[]
  data: T[]
  isLoading?: boolean
  emptyMessage?: string
  getRowKey?: (row: T) => string
  toolbar?: (selectedRows: T[], clearSelection: () => void) => React.ReactNode
  /**
   * Optional phone layout. When set, rows render as stacked cards below `sm` and the table
   * shows from `sm` up. Return the card body (main field, status, the row's actions).
   * Selection (when `getRowKey` is set) is drawn here with a 40px checkbox target.
   */
  mobileCard?: (row: T) => React.ReactNode
}

export function DataTable<T>({
  columns, data, isLoading, emptyMessage = "No data.", getRowKey, toolbar, mobileCard,
}: DataTableProps<T>) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  // Clear selection when data changes
  React.useEffect(() => { setSelected(new Set()) }, [data])

  const selectable = !!getRowKey
  const allKeys = selectable ? data.map(getRowKey!) : []
  const allSelected = allKeys.length > 0 && allKeys.every(k => selected.has(k))
  const someSelected = !allSelected && allKeys.some(k => selected.has(k))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(allKeys))
  }

  function toggleRow(key: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function clearSelection() { setSelected(new Set()) }

  const selectedRows = selectable ? data.filter(row => selected.has(getRowKey!(row))) : []
  const colSpan = columns.length + (selectable ? 1 : 0)

  return (
    <div>
      {toolbar && (
        <div className="flex items-center justify-between mb-2 min-h-[2rem]">
          {toolbar(selectedRows, clearSelection)}
        </div>
      )}
      {mobileCard && (
        <ul data-slot="data-table-cards" className="flex flex-col gap-2 sm:hidden">
          {isLoading ? (
            [0, 1, 2].map(i => (
              <li key={i} aria-hidden className="h-20 animate-pulse rounded-xl bg-surface-2 motion-reduce:animate-none" />
            ))
          ) : data.length === 0 ? (
            <li className="rounded-xl border border-border px-4 py-6 text-sm text-fg-muted">{emptyMessage}</li>
          ) : (
            data.map((row, rowIdx) => {
              const key = selectable ? getRowKey!(row) : String(rowIdx)
              return (
                <li key={key} className="flex items-start gap-1 rounded-xl border border-border bg-card p-3">
                  {selectable && (
                    <label className="-my-1.5 -ml-1.5 flex size-10 shrink-0 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label="Select"
                        className="h-4 w-4 rounded-md border-border-strong bg-surface accent-foreground cursor-pointer"
                        checked={selected.has(key)}
                        onChange={() => toggleRow(key)}
                      />
                    </label>
                  )}
                  <div className="min-w-0 flex-1">{mobileCard(row)}</div>
                </li>
              )
            })
          )}
        </ul>
      )}
      <div className={mobileCard ? "hidden sm:block" : undefined}>
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            {selectable && (
              <TableHead className="w-8 text-fg-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded-md border-border-strong bg-surface accent-white cursor-pointer"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleAll}
                />
              </TableHead>
            )}
            {columns.map((col, i) => (
              <TableHead key={i} className={col.className ?? "text-fg-muted font-medium"}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow className="border-border hover:bg-transparent">
              <TableCell colSpan={colSpan} className="text-fg-muted text-sm py-4">
                Loading…
              </TableCell>
            </TableRow>
          ) : data.length === 0 ? (
            <TableRow className="border-border hover:bg-transparent">
              <TableCell colSpan={colSpan} className="text-fg-muted text-sm py-4">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((row, rowIdx) => {
              const key = selectable ? getRowKey!(row) : String(rowIdx)
              const isChecked = selectable && selected.has(key)
              return (
                <TableRow key={key} className="border-border">
                  {selectable && (
                    <TableCell className="py-2.5 w-8">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded-md border-border-strong bg-surface accent-white cursor-pointer"
                        checked={isChecked}
                        onChange={() => toggleRow(key)}
                      />
                    </TableCell>
                  )}
                  {columns.map((col, colIdx) => (
                    <TableCell key={colIdx} className={col.className ?? "text-foreground py-2.5"}>
                      {col.cell ? col.cell(row) : col.accessorKey != null ? String(row[col.accessorKey] ?? "") : null}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
      </div>
    </div>
  )
}
