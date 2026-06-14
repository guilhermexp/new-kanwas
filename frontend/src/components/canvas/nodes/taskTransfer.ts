import { useCallback } from 'react'
import type { ChecklistItem, ChecklistNodeData, KanbanNodeData, KanbanTask } from 'shared'
import { useWorkspace } from '@/providers/workspace'
import { findNodeById } from '@/lib/workspaceUtils'

export const TASK_TRANSFER_MIME = 'application/x-kanwas-task'

export type TaskTransferPayload = {
  kind: 'checklist-item' | 'kanban-task'
  sourceNodeId: string
  sourceColumnId?: string
  itemId: string
  text: string
  checked: boolean
  depth?: number
  task?: KanbanTask
}

function isTaskTransferPayload(value: unknown): value is TaskTransferPayload {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    (record.kind === 'checklist-item' || record.kind === 'kanban-task') &&
    typeof record.sourceNodeId === 'string' &&
    typeof record.itemId === 'string' &&
    typeof record.text === 'string' &&
    typeof record.checked === 'boolean'
  )
}

function parsePayload(raw: string): TaskTransferPayload | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw)
    return isTaskTransferPayload(value) ? value : null
  } catch {
    return null
  }
}

export function writeTaskTransfer(event: React.DragEvent, payload: TaskTransferPayload): void {
  const serialized = JSON.stringify(payload)
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(TASK_TRANSFER_MIME, serialized)
  event.dataTransfer.setData('application/json', serialized)
  event.dataTransfer.setData('text/plain', payload.text)
}

export function readTaskTransfer(dataTransfer: DataTransfer): TaskTransferPayload | null {
  return (
    parsePayload(dataTransfer.getData(TASK_TRANSFER_MIME)) ?? parsePayload(dataTransfer.getData('application/json'))
  )
}

export function taskPayloadToChecklistItem(payload: TaskTransferPayload, id = payload.itemId): ChecklistItem {
  return {
    id,
    text: payload.text,
    checked: payload.checked,
    ...(typeof payload.depth === 'number' ? { depth: payload.depth } : {}),
  }
}

export function taskPayloadToKanbanTask(payload: TaskTransferPayload, id = payload.itemId): KanbanTask {
  if (payload.task) {
    return {
      ...payload.task,
      id,
      text: payload.task.text || payload.text,
      checked: payload.task.checked,
    }
  }

  return {
    id,
    text: payload.text,
    checked: payload.checked,
  }
}

export function useTaskTransferSourceRemoval(currentNodeId: string) {
  const { store } = useWorkspace()

  return useCallback(
    (payload: TaskTransferPayload): void => {
      if (payload.sourceNodeId === currentNodeId || !store.root) return

      const located = findNodeById(store.root, payload.sourceNodeId)
      if (!located) return

      if (located.node.xynode.type === 'checklist') {
        const data = located.node.xynode.data as ChecklistNodeData
        data.items = data.items.filter((item) => item.id !== payload.itemId)
        return
      }

      if (located.node.xynode.type === 'kanban') {
        const data = located.node.xynode.data as KanbanNodeData
        for (const column of data.columns) {
          if (payload.sourceColumnId && column.id !== payload.sourceColumnId) continue
          column.tasks = column.tasks.filter((task) => task.id !== payload.itemId)
        }
      }
    },
    [currentNodeId, store]
  )
}
