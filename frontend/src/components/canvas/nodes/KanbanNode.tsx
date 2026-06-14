import { memo, useCallback, useMemo } from 'react'
import type {
  KanbanColumn,
  KanbanField,
  KanbanFieldType,
  KanbanNode as KanbanNodeType,
  KanbanNodeData,
  KanbanTask,
  KanbanTaskDependency,
} from 'shared'
import { KANBAN_NODE_LAYOUT } from 'shared/constants'
import type { WithCanvasData } from '../types'
import { DocumentName } from './DocumentName'
import { positiveNodeDimension } from './nodeDimensions'
import { ResizableNodeHandle } from './ResizableNodeHandle'
import { useNodeData } from './useNodeData'
import {
  readTaskTransfer,
  taskPayloadToKanbanTask,
  useTaskTransferSourceRemoval,
  writeTaskTransfer,
  type TaskTransferPayload,
} from './taskTransfer'

type KanbanNodeProps = WithCanvasData<KanbanNodeType>

const FIELD_TYPES: KanbanFieldType[] = ['text', 'date', 'number', 'select']
const KANBAN_MIN_WIDTH = 520
const KANBAN_MIN_HEIGHT = 320
const KANBAN_MAX_WIDTH = 1800
const KANBAN_MAX_HEIGHT = 1200

function insertTask(tasks: KanbanTask[], task: KanbanTask, index: number): KanbanTask[] {
  const next = [...tasks]
  next.splice(Math.min(index, next.length), 0, task)
  return next
}

function moveTaskWithinBoard(
  columns: KanbanColumn[],
  payload: TaskTransferPayload,
  targetColumnId: string,
  insertionIndex: number
): KanbanColumn[] {
  const sourceColumnIndex = columns.findIndex((column) => column.id === payload.sourceColumnId)
  const targetColumnIndex = columns.findIndex((column) => column.id === targetColumnId)
  if (targetColumnIndex === -1) return columns

  const nextColumns = columns.map((column) => ({ ...column, tasks: [...column.tasks] }))
  let movedTask: KanbanTask | null = null
  let sourceTaskIndex = -1

  if (sourceColumnIndex !== -1) {
    sourceTaskIndex = nextColumns[sourceColumnIndex].tasks.findIndex((task) => task.id === payload.itemId)
    if (sourceTaskIndex !== -1) {
      movedTask = nextColumns[sourceColumnIndex].tasks[sourceTaskIndex]
      nextColumns[sourceColumnIndex].tasks.splice(sourceTaskIndex, 1)
    }
  }

  if (!movedTask) {
    movedTask = taskPayloadToKanbanTask(payload, crypto.randomUUID())
  }

  const adjustedIndex =
    sourceColumnIndex === targetColumnIndex && sourceTaskIndex !== -1 && sourceTaskIndex < insertionIndex
      ? insertionIndex - 1
      : insertionIndex
  nextColumns[targetColumnIndex].tasks = insertTask(nextColumns[targetColumnIndex].tasks, movedTask, adjustedIndex)
  return nextColumns
}

function flattenTasks(columns: KanbanColumn[]): KanbanTask[] {
  return columns.flatMap((column) => column.tasks)
}

function dependencyLabel(taskId: string, allTasks: KanbanTask[]): string {
  return allTasks.find((task) => task.id === taskId)?.text ?? taskId
}

export default memo(function KanbanNode({ id, data, selected, width, height }: KanbanNodeProps) {
  const { documentName = 'Kanban', columns, fields } = data
  const getNodeData = useNodeData<KanbanNodeData>(id, 'kanban')
  const removeFromSource = useTaskTransferSourceRemoval(id)
  const allTasks = useMemo(() => flattenTasks(columns), [columns])
  const nodeWidth = positiveNodeDimension(width) ?? KANBAN_NODE_LAYOUT.DEFAULT_MEASURED.width
  const nodeHeight = positiveNodeDimension(height) ?? KANBAN_NODE_LAYOUT.DEFAULT_MEASURED.height

  const updateBoard = useCallback(
    (mutate: (data: KanbanNodeData) => void) => {
      const nodeData = getNodeData()
      if (!nodeData) return
      mutate(nodeData)
    },
    [getNodeData]
  )

  const addColumn = useCallback(() => {
    updateBoard((nodeData) => {
      nodeData.columns = [
        ...nodeData.columns,
        {
          id: crypto.randomUUID(),
          title: 'New column',
          tasks: [],
          color: '#6b7280',
        },
      ]
    })
  }, [updateBoard])

  const updateColumn = useCallback(
    (columnId: string, patch: Partial<KanbanColumn>) => {
      updateBoard((nodeData) => {
        nodeData.columns = nodeData.columns.map((column) => (column.id === columnId ? { ...column, ...patch } : column))
      })
    },
    [updateBoard]
  )

  const deleteColumn = useCallback(
    (columnId: string) => {
      updateBoard((nodeData) => {
        nodeData.columns = nodeData.columns.filter((column) => column.id !== columnId)
      })
    },
    [updateBoard]
  )

  const addTask = useCallback(
    (columnId: string) => {
      updateBoard((nodeData) => {
        nodeData.columns = nodeData.columns.map((column) =>
          column.id === columnId
            ? {
                ...column,
                tasks: [
                  ...column.tasks,
                  {
                    id: crypto.randomUUID(),
                    text: 'New task',
                    checked: false,
                  },
                ],
              }
            : column
        )
      })
    },
    [updateBoard]
  )

  const updateTask = useCallback(
    (columnId: string, taskId: string, patch: Partial<KanbanTask>) => {
      updateBoard((nodeData) => {
        nodeData.columns = nodeData.columns.map((column) =>
          column.id === columnId
            ? {
                ...column,
                tasks: column.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
              }
            : column
        )
      })
    },
    [updateBoard]
  )

  const deleteTask = useCallback(
    (columnId: string, taskId: string) => {
      updateBoard((nodeData) => {
        nodeData.columns = nodeData.columns.map((column) =>
          column.id === columnId
            ? {
                ...column,
                tasks: column.tasks.filter((task) => task.id !== taskId),
              }
            : column
        )
      })
    },
    [updateBoard]
  )

  const upsertTaskField = useCallback(
    (columnId: string, task: KanbanTask, fieldId: string, value: string) => {
      updateTask(columnId, task.id, {
        fields: {
          ...(task.fields ?? {}),
          [fieldId]: value,
        },
      })
    },
    [updateTask]
  )

  const addField = useCallback(() => {
    updateBoard((nodeData) => {
      nodeData.fields = [
        ...nodeData.fields,
        {
          id: crypto.randomUUID(),
          name: 'Field',
          type: 'text',
          visible: true,
        },
      ]
    })
  }, [updateBoard])

  const updateField = useCallback(
    (fieldId: string, patch: Partial<KanbanField>) => {
      updateBoard((nodeData) => {
        nodeData.fields = nodeData.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field))
      })
    },
    [updateBoard]
  )

  const deleteField = useCallback(
    (fieldId: string) => {
      updateBoard((nodeData) => {
        nodeData.fields = nodeData.fields.filter((field) => field.id !== fieldId)
        nodeData.columns = nodeData.columns.map((column) => ({
          ...column,
          tasks: column.tasks.map((task) => {
            const nextFields = { ...(task.fields ?? {}) }
            delete nextFields[fieldId]
            return { ...task, fields: nextFields }
          }),
        }))
      })
    },
    [updateBoard]
  )

  const addDependency = useCallback(
    (columnId: string, task: KanbanTask, dependsOnTaskId: string) => {
      if (!dependsOnTaskId || dependsOnTaskId === task.id) return
      const currentDependencies = task.dependencies ?? []
      if (currentDependencies.some((dependency) => dependency.taskId === dependsOnTaskId)) return

      const dependency: KanbanTaskDependency = {
        taskId: dependsOnTaskId,
        relationType: 'blocked-by',
        title: dependencyLabel(dependsOnTaskId, allTasks),
      }
      updateTask(columnId, task.id, { dependencies: [...currentDependencies, dependency] })
    },
    [allTasks, updateTask]
  )

  const removeDependency = useCallback(
    (columnId: string, task: KanbanTask, dependsOnTaskId: string) => {
      updateTask(columnId, task.id, {
        dependencies: (task.dependencies ?? []).filter((dependency) => dependency.taskId !== dependsOnTaskId),
      })
    },
    [updateTask]
  )

  const handleTaskDrop = useCallback(
    (event: React.DragEvent, targetColumnId: string, insertionIndex: number) => {
      const payload = readTaskTransfer(event.dataTransfer)
      if (!payload) return

      event.preventDefault()
      event.stopPropagation()
      updateBoard((nodeData) => {
        if (payload.sourceNodeId === id) {
          nodeData.columns = moveTaskWithinBoard(nodeData.columns, payload, targetColumnId, insertionIndex)
          return
        }

        const targetIndex = nodeData.columns.findIndex((column) => column.id === targetColumnId)
        if (targetIndex === -1) return
        const task = taskPayloadToKanbanTask(payload, crypto.randomUUID())
        nodeData.columns[targetIndex].tasks = insertTask(nodeData.columns[targetIndex].tasks, task, insertionIndex)
      })
      removeFromSource(payload)
    },
    [id, removeFromSource, updateBoard]
  )

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-editor text-foreground shadow-sm ${selected ? 'border-foreground/60' : 'border-outline'}`}
      style={{ width: nodeWidth, height: nodeHeight }}
    >
      <ResizableNodeHandle
        selected={Boolean(selected)}
        minWidth={KANBAN_MIN_WIDTH}
        minHeight={KANBAN_MIN_HEIGHT}
        maxWidth={KANBAN_MAX_WIDTH}
        maxHeight={KANBAN_MAX_HEIGHT}
      />
      <DocumentName
        nodeId={id}
        documentName={documentName}
        extension=".kanban"
        containerStyle={{ maxWidth: Math.max(160, nodeWidth - 60) }}
      />
      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
        <div className="nodrag nowheel mb-3 flex shrink-0 items-center gap-2 overflow-x-auto border-b border-outline pb-3">
          <button
            type="button"
            className="h-7 shrink-0 rounded-md border border-outline px-2 text-xs text-foreground-muted hover:text-foreground"
            onClick={addColumn}
          >
            <i className="fa-solid fa-plus mr-1 text-[10px]" />
            Column
          </button>
          <button
            type="button"
            className="h-7 shrink-0 rounded-md border border-outline px-2 text-xs text-foreground-muted hover:text-foreground"
            onClick={addField}
          >
            <i className="fa-solid fa-table-list mr-1 text-[10px]" />
            Field
          </button>
          {fields.map((field) => (
            <div key={field.id} className="flex items-center gap-1 rounded-md border border-outline px-1 py-0.5">
              <input
                value={field.name}
                onChange={(event) => updateField(field.id, { name: event.target.value })}
                className="w-20 bg-transparent text-xs text-foreground placeholder:text-foreground-muted outline-none"
              />
              <select
                value={field.type}
                onChange={(event) => updateField(field.id, { type: event.target.value as KanbanFieldType })}
                className="bg-transparent text-xs text-foreground outline-none dark:[color-scheme:dark]"
              >
                {FIELD_TYPES.map((fieldType) => (
                  <option key={fieldType} value={fieldType} className="bg-editor text-foreground">
                    {fieldType}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-foreground-muted hover:text-red-400"
                onClick={() => deleteField(field.id)}
              >
                <i className="fa-solid fa-xmark text-[11px]" />
              </button>
            </div>
          ))}
        </div>

        <div className="nodrag nowheel flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
          {columns.map((column) => (
            <div
              key={column.id}
              className="flex h-full min-w-[238px] max-w-[238px] flex-col rounded-md border border-outline bg-canvas/40"
              onDragOver={(event) => {
                if (readTaskTransfer(event.dataTransfer)) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                }
              }}
              onDrop={(event) => handleTaskDrop(event, column.id, column.tasks.length)}
            >
              <div className="border-b border-outline p-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: column.color ?? '#6b7280' }} />
                  <input
                    value={column.title}
                    onChange={(event) => updateColumn(column.id, { title: event.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground placeholder:text-foreground-muted outline-none"
                  />
                  <button
                    type="button"
                    className="text-foreground-muted hover:text-red-400"
                    onClick={() => deleteColumn(column.id)}
                  >
                    <i className="fa-solid fa-trash text-[11px]" />
                  </button>
                </div>
                <input
                  value={column.description ?? ''}
                  onChange={(event) => updateColumn(column.id, { description: event.target.value })}
                  className="mt-1 w-full bg-transparent text-xs text-foreground-muted outline-none"
                  placeholder="Description"
                />
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                {column.tasks.map((task, index) => (
                  <div
                    key={task.id}
                    className="group rounded-md border border-outline bg-editor p-2 shadow-sm"
                    draggable
                    onDragStart={(event) => {
                      writeTaskTransfer(event, {
                        kind: 'kanban-task',
                        sourceNodeId: id,
                        sourceColumnId: column.id,
                        itemId: task.id,
                        text: task.text,
                        checked: task.checked,
                        task,
                      })
                    }}
                    onDragOver={(event) => {
                      if (readTaskTransfer(event.dataTransfer)) {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                      }
                    }}
                    onDrop={(event) => handleTaskDrop(event, column.id, index)}
                  >
                    <div className="flex items-start gap-2">
                      <i className="fa-solid fa-grip-vertical mt-1 text-[10px] text-foreground-muted/50" />
                      <input
                        type="checkbox"
                        checked={task.checked}
                        onChange={(event) => updateTask(column.id, task.id, { checked: event.target.checked })}
                        className="mt-0.5 h-4 w-4 accent-primary-button-background"
                      />
                      <textarea
                        value={task.text}
                        onChange={(event) => updateTask(column.id, task.id, { text: event.target.value })}
                        className="min-h-8 flex-1 resize-none bg-transparent text-sm font-medium leading-tight text-foreground placeholder:text-foreground-muted outline-none"
                      />
                      <button
                        type="button"
                        className="opacity-0 text-foreground-muted transition-opacity hover:text-red-400 group-hover:opacity-100"
                        onClick={() => deleteTask(column.id, task.id)}
                      >
                        <i className="fa-solid fa-xmark text-[11px]" />
                      </button>
                    </div>
                    <input
                      value={task.assigneeName ?? ''}
                      onChange={(event) => updateTask(column.id, task.id, { assigneeName: event.target.value })}
                      className="mt-2 w-full rounded border border-outline bg-transparent px-2 py-1 text-xs text-foreground placeholder:text-foreground-muted outline-none"
                      placeholder="Assignee"
                    />
                    {fields.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {fields
                          .filter((field) => field.visible !== false)
                          .map((field) => (
                            <label key={field.id} className="block text-[11px] text-foreground-muted">
                              <span className="mb-0.5 block truncate">{field.name || 'Field'}</span>
                              {field.type === 'select' ? (
                                <input
                                  value={task.fields?.[field.id] ?? ''}
                                  onChange={(event) => upsertTaskField(column.id, task, field.id, event.target.value)}
                                  className="w-full rounded border border-outline bg-transparent px-2 py-1 text-xs text-foreground placeholder:text-foreground-muted outline-none"
                                />
                              ) : (
                                <input
                                  type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                                  value={task.fields?.[field.id] ?? ''}
                                  onChange={(event) => upsertTaskField(column.id, task, field.id, event.target.value)}
                                  className="w-full rounded border border-outline bg-transparent px-2 py-1 text-xs text-foreground placeholder:text-foreground-muted outline-none dark:[color-scheme:dark]"
                                />
                              )}
                            </label>
                          ))}
                      </div>
                    ) : null}
                    <div className="mt-2">
                      <select
                        value=""
                        onChange={(event) => {
                          addDependency(column.id, task, event.target.value)
                          event.currentTarget.value = ''
                        }}
                        className="w-full rounded border border-outline bg-transparent px-2 py-1 text-xs text-foreground outline-none dark:[color-scheme:dark]"
                      >
                        <option value="" className="bg-editor text-foreground-muted">
                          Dependency
                        </option>
                        {allTasks
                          .filter((candidate) => candidate.id !== task.id)
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id} className="bg-editor text-foreground">
                              {candidate.text}
                            </option>
                          ))}
                      </select>
                      {(task.dependencies ?? []).length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(task.dependencies ?? []).map((dependency) => (
                            <button
                              key={dependency.taskId}
                              type="button"
                              className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground-muted hover:text-foreground"
                              onClick={() => removeDependency(column.id, task, dependency.taskId)}
                            >
                              {dependency.relationType}:{' '}
                              {dependency.title ?? dependencyLabel(dependency.taskId, allTasks)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="m-2 h-8 rounded-md border border-dashed border-outline text-sm text-foreground-muted hover:text-foreground"
                onClick={() => addTask(column.id)}
              >
                <i className="fa-solid fa-plus mr-1 text-[11px]" />
                Task
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
