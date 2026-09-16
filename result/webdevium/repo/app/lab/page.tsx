'use client'

import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SelectableTable, type SelectableTableRow } from '@/components/interactive/selectable-table'
import { SearchCombobox, type ComboboxOption } from '@/components/interactive/search-combobox'
import { ToastProvider, useToasts } from '@/components/interactive/toast-queue'
import { ConfirmDialog } from '@/components/interactive/confirm-dialog'
import { UsageMeter } from '@/components/interactive/usage-meter'
import { SortableList, type SortableItem } from '@/components/interactive/sortable-list'
import { PaginatedList, type PaginatedItem } from '@/components/interactive/paginated-list'
import { TaskFilterBar } from '@/components/interactive/task-filter-bar'
import { StepperWizard } from '@/components/interactive/stepper-wizard'
import { NotificationCenter, type AppNotification } from '@/components/interactive/notification-center'
import { EMPTY_TASK_FILTERS, type FilterableTask, type TaskFilters } from '@/lib/task-filters'

const TABLE_ROWS: SelectableTableRow[] = [
  { id: 'alpha', label: 'Alpha site', description: 'Marketing homepage' },
  { id: 'beta', label: 'Beta app', description: 'Client portal' },
  { id: 'gamma', label: 'Gamma shop', description: 'Checkout work' },
  { id: 'delta', label: 'Delta docs', description: 'Help center' },
]

const CLIENTS: ComboboxOption[] = [
  { id: 'acme', label: 'Acme Health', hint: 'Growth plan' },
  { id: 'north', label: 'Northwind', hint: 'Starter plan' },
  { id: 'orbit', label: 'Orbit Labs', hint: 'Scale plan' },
]

const INVOICES: PaginatedItem[] = Array.from({ length: 9 }, (_, index) => ({
  id: `inv-${index + 1}`,
  label: index % 2 === 0 ? `Invoice ${index + 1}` : `Credit ${index + 1}`,
  meta: `$${(index + 1) * 40}`,
}))

const SAMPLE_TASKS: FilterableTask[] = [
  { id: '1', title: 'Homepage refresh', status: 'queued', priority: 'high' },
  { id: '2', title: 'Checkout bug', status: 'in_progress', priority: 'high' },
  { id: '3', title: 'Docs pass', status: 'done', priority: 'low' },
  { id: '4', title: 'Billing copy', status: 'queued', priority: 'medium' },
]

function LabDemos() {
  const { publish } = useToasts()
  const [selectedIds, setSelectedIds] = useState<string[]>(['alpha'])
  const [queue, setQueue] = useState<SortableItem[]>([
    { id: 'one', label: 'Kickoff' },
    { id: 'two', label: 'Design' },
    { id: 'three', label: 'Launch' },
  ])
  const [filters, setFilters] = useState<TaskFilters>(EMPTY_TASK_FILTERS)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [usedHours, setUsedHours] = useState(12)
  const [notifications, setNotifications] = useState<AppNotification[]>([
    { id: '1', title: 'Task assigned', body: 'Checkout bug was assigned to you.', read: false },
    { id: '2', title: 'Invoice paid', body: 'April invoice is paid.', read: true },
    { id: '3', title: 'Comment', body: 'A client left a comment.', read: false },
  ])

  const searchClients = useCallback(async (query: string) => {
    const normalized = query.trim().toLowerCase()
    await new Promise((resolve) => setTimeout(resolve, 80))
    if (!normalized) return CLIENTS
    return CLIENTS.filter((client) => client.label.toLowerCase().includes(normalized))
  }, [])

  const filterRows = useCallback(async (query: string) => {
    const normalized = query.trim().toLowerCase()
    await new Promise((resolve) => setTimeout(resolve, 60))
    if (!normalized) return TABLE_ROWS
    return TABLE_ROWS.filter(
      (row) =>
        row.label.toLowerCase().includes(normalized) ||
        (row.description?.toLowerCase().includes(normalized) ?? false)
    )
  }, [])

  const usageLimit = 20
  const usageLabel = useMemo(
    () => `${usedHours} of ${usageLimit} hours`,
    [usedHours, usageLimit]
  )

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Interactive component lab</h1>
        <p className="text-sm text-muted-foreground">
          Local demos with in-memory data. No login or external services required.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Selectable table</CardTitle>
          <CardDescription>
            Selection is stored by row id, so filtered-out rows stay selected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SelectableTable
            rows={TABLE_ROWS}
            onFilter={filterRows}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search combobox</CardTitle>
          <CardDescription>Async results ignore slower, out-of-order responses.</CardDescription>
        </CardHeader>
        <CardContent>
          <SearchCombobox label="Find client" onSearch={searchClients} />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Usage meter</CardTitle>
            <CardDescription>Status is also announced as text: {usageLabel}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageMeter label="Monthly hours" used={usedHours} limit={usageLimit} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setUsedHours(12)}>
                On track
              </Button>
              <Button type="button" variant="outline" onClick={() => setUsedHours(17)}>
                Approaching
              </Button>
              <Button type="button" variant="outline" onClick={() => setUsedHours(24)}>
                Exceeded
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Toasts and confirm</CardTitle>
            <CardDescription>Focus returns to the trigger after the dialog closes.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => publish({ title: 'Task queued', description: 'Homepage refresh' })}
            >
              Show toast
            </Button>
            <Button type="button" variant="destructive" onClick={() => setConfirmOpen(true)}>
              Delete task
            </Button>
            <ConfirmDialog
              open={confirmOpen}
              title="Delete this task?"
              description="This cannot be undone."
              confirmLabel="Delete"
              onConfirm={() => {
                setConfirmOpen(false)
                publish({ title: 'Task deleted' })
              }}
              onCancel={() => setConfirmOpen(false)}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sortable queue</CardTitle>
          <CardDescription>Use the buttons or Alt+Arrow keys to reorder.</CardDescription>
        </CardHeader>
        <CardContent>
          <SortableList items={queue} onReorder={setQueue} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paginated invoices</CardTitle>
          <CardDescription>Filtering returns you to page 1.</CardDescription>
        </CardHeader>
        <CardContent>
          <PaginatedList items={INVOICES} pageSize={3} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Task filters</CardTitle>
          <CardDescription>Search, status, and priority combine together.</CardDescription>
        </CardHeader>
        <CardContent>
          <TaskFilterBar tasks={SAMPLE_TASKS} filters={filters} onChange={setFilters} />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create-task wizard</CardTitle>
            <CardDescription>Back keeps the values you already entered.</CardDescription>
          </CardHeader>
          <CardContent>
            <StepperWizard
              onComplete={(values) =>
                publish({ title: 'Task created', description: values.title })
              }
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notification center</CardTitle>
            <CardDescription>Unread count stays in sync with the list.</CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationCenter notifications={notifications} onChange={setNotifications} />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function LabPage() {
  return (
    <ToastProvider>
      <LabDemos />
    </ToastProvider>
  )
}
