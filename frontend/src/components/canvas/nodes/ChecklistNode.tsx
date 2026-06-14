import { memo, useCallback } from 'react'
import type { ChecklistItem, ChecklistNode as ChecklistNodeType, ChecklistNodeData } from 'shared'
import { CHECKLIST_NODE_LAYOUT } from 'shared/constants'
import type { WithCanvasData } from '../types'
import { DocumentName } from './DocumentName'
import { positiveNodeDimension } from './nodeDimensions'
import { ResizableNodeHandle } from './ResizableNodeHandle'
import { useNodeData } from './useNodeData'
import {
  readTaskTransfer,
  taskPayloadToChecklistItem,
  useTaskTransferSourceRemoval,
  writeTaskTransfer,
  type TaskTransferPayload,
} from './taskTransfer'

type ChecklistNodeProps = WithCanvasData<ChecklistNodeType>

const CHECKLIST_MIN_WIDTH = 300
const CHECKLIST_MIN_HEIGHT = 260
const CHECKLIST_MAX_WIDTH = 900
const CHECKLIST_MAX_HEIGHT = 1000

function clampDepth(depth: number): number {
  return Math.min(4, Math.max(0, depth))
}

function insertItem(items: ChecklistItem[], item: ChecklistItem, index: number): ChecklistItem[] {
  const next = [...items]
  next.splice(Math.min(index, next.length), 0, item)
  return next
}

export default memo(function ChecklistNode({ id, data, selected, width, height }: ChecklistNodeProps) {
  const { documentName = 'Checklist', items = [], accentColor = '#8b5cf6' } = data
  const getNodeData = useNodeData<ChecklistNodeData>(id, 'checklist')
  const removeFromSource = useTaskTransferSourceRemoval(id)
  const nodeWidth = positiveNodeDimension(width) ?? CHECKLIST_NODE_LAYOUT.DEFAULT_MEASURED.width
  const nodeHeight = positiveNodeDimension(height) ?? CHECKLIST_NODE_LAYOUT.DEFAULT_MEASURED.height

  const updateItems = useCallback(
    (mutate: (items: ChecklistItem[]) => ChecklistItem[]) => {
      const nodeData = getNodeData()
      if (!nodeData) return
      nodeData.items = mutate(nodeData.items ?? [])
    },
    [getNodeData]
  )

  const addItem = useCallback(() => {
    updateItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        text: 'New item',
        checked: false,
        depth: 0,
      },
    ])
  }, [updateItems])

  const updateItem = useCallback(
    (itemId: string, patch: Partial<ChecklistItem>) => {
      updateItems((current) => current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)))
    },
    [updateItems]
  )

  const deleteItem = useCallback(
    (itemId: string) => {
      updateItems((current) => current.filter((item) => item.id !== itemId))
    },
    [updateItems]
  )

  const handleDropPayload = useCallback(
    (payload: TaskTransferPayload, insertionIndex: number) => {
      updateItems((current) => {
        const existingIndex = current.findIndex((item) => item.id === payload.itemId)
        const movingWithinNode = payload.sourceNodeId === id && existingIndex !== -1
        const nextId = movingWithinNode ? payload.itemId : crypto.randomUUID()
        const nextItem = taskPayloadToChecklistItem(payload, nextId)

        if (!movingWithinNode) {
          removeFromSource(payload)
          return insertItem(current, nextItem, insertionIndex)
        }

        const withoutSource = current.filter((item) => item.id !== payload.itemId)
        const adjustedIndex = existingIndex < insertionIndex ? insertionIndex - 1 : insertionIndex
        return insertItem(withoutSource, nextItem, adjustedIndex)
      })
    },
    [id, removeFromSource, updateItems]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent, insertionIndex: number) => {
      const payload = readTaskTransfer(event.dataTransfer)
      if (!payload) return

      event.preventDefault()
      event.stopPropagation()
      handleDropPayload(payload, insertionIndex)
    },
    [handleDropPayload]
  )

  const doneCount = items.filter((item) => item.checked).length
  const totalCount = items.length

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-editor shadow-sm ${selected ? 'border-foreground/60' : 'border-outline'}`}
      style={{ width: nodeWidth, height: nodeHeight }}
    >
      <ResizableNodeHandle
        selected={Boolean(selected)}
        minWidth={CHECKLIST_MIN_WIDTH}
        minHeight={CHECKLIST_MIN_HEIGHT}
        maxWidth={CHECKLIST_MAX_WIDTH}
        maxHeight={CHECKLIST_MAX_HEIGHT}
      />
      <DocumentName
        nodeId={id}
        documentName={documentName}
        extension=".checklist"
        containerStyle={{ maxWidth: Math.max(120, nodeWidth - 32) }}
      />
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-1">
        <div className="flex items-center justify-between border-b border-outline pb-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-foreground-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accentColor }} />
            Checklist
          </div>
          <div className="text-xs text-foreground-muted">
            {doneCount}/{totalCount}
          </div>
        </div>

        <div
          className="nodrag nowheel mt-3 min-h-0 flex-1 overflow-y-auto pr-1"
          onDragOver={(event) => {
            if (readTaskTransfer(event.dataTransfer)) {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
            }
          }}
          onDrop={(event) => handleDrop(event, items.length)}
        >
          {items.map((item, index) => (
            <div
              key={item.id}
              className="group flex min-h-9 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-outline hover:bg-secondary/30"
              style={{ paddingLeft: 8 + clampDepth(item.depth ?? 0) * 18 }}
              draggable
              onDragStart={(event) => {
                writeTaskTransfer(event, {
                  kind: 'checklist-item',
                  sourceNodeId: id,
                  itemId: item.id,
                  text: item.text,
                  checked: item.checked,
                  depth: item.depth ?? 0,
                })
              }}
              onDragOver={(event) => {
                if (readTaskTransfer(event.dataTransfer)) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }
              }}
              onDrop={(event) => handleDrop(event, index)}
            >
              <i className="fa-solid fa-grip-vertical text-[10px] text-foreground-muted/50" />
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(event) => updateItem(item.id, { checked: event.target.checked })}
                className="h-4 w-4 accent-primary-button-background"
              />
              <input
                value={item.text}
                onChange={(event) => updateItem(item.id, { text: event.target.value })}
                className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${
                  item.checked ? 'text-foreground-muted line-through' : 'text-foreground'
                }`}
              />
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100 text-foreground-muted hover:text-foreground"
                onClick={() => updateItem(item.id, { depth: clampDepth((item.depth ?? 0) - 1) })}
                type="button"
              >
                <i className="fa-solid fa-outdent text-[11px]" />
              </button>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100 text-foreground-muted hover:text-foreground"
                onClick={() => updateItem(item.id, { depth: clampDepth((item.depth ?? 0) + 1) })}
                type="button"
              >
                <i className="fa-solid fa-indent text-[11px]" />
              </button>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100 text-foreground-muted hover:text-red-400"
                onClick={() => deleteItem(item.id)}
                type="button"
              >
                <i className="fa-solid fa-xmark text-[12px]" />
              </button>
            </div>
          ))}
          {items.length === 0 ? (
            <button
              type="button"
              className="flex h-28 w-full items-center justify-center rounded-md border border-dashed border-outline text-sm text-foreground-muted hover:text-foreground"
              onClick={addItem}
            >
              Add item
            </button>
          ) : null}
        </div>

        {items.length > 0 ? (
          <button
            type="button"
            className="nodrag mt-3 flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-outline text-sm text-foreground-muted transition-colors hover:text-foreground"
            onClick={addItem}
          >
            <i className="fa-solid fa-plus text-[11px]" />
            Add item
          </button>
        ) : null}
      </div>
    </div>
  )
})
