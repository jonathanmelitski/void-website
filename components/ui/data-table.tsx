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
}

export function DataTable<T>({
  columns, data, isLoading, emptyMessage = "No data.", getRowKey, toolbar,
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
      <Table>
        <TableHeader>
          <TableRow className="border-white/10 hover:bg-transparent">
            {selectable && (
              <TableHead className="w-8 text-white/40">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-white/20 bg-white/5 accent-white cursor-pointer"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleAll}
                />
              </TableHead>
            )}
            {columns.map((col, i) => (
              <TableHead key={i} className={col.className ?? "text-white/40 font-medium"}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow className="border-white/5 hover:bg-transparent">
              <TableCell colSpan={colSpan} className="text-white/40 text-sm py-4">
                Loading…
              </TableCell>
            </TableRow>
          ) : data.length === 0 ? (
            <TableRow className="border-white/5 hover:bg-transparent">
              <TableCell colSpan={colSpan} className="text-white/40 text-sm py-4">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            data.map((row, rowIdx) => {
              const key = selectable ? getRowKey!(row) : String(rowIdx)
              const isChecked = selectable && selected.has(key)
              return (
                <TableRow key={key} className="border-white/5">
                  {selectable && (
                    <TableCell className="py-2.5 w-8">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-white/20 bg-white/5 accent-white cursor-pointer"
                        checked={isChecked}
                        onChange={() => toggleRow(key)}
                      />
                    </TableCell>
                  )}
                  {columns.map((col, colIdx) => (
                    <TableCell key={colIdx} className={col.className ?? "text-white/80 py-2.5"}>
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
  )
}
