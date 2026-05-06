import type { SuggestedTasksItem } from 'backend/agent'
import type { WorkspaceSuggestedTask } from '@/api/suggestedTasks'

export interface SuggestedTaskStartRequest {
  task: WorkspaceSuggestedTask
  deleteSuggestionId?: string
}

export function createPersistedSuggestedTaskStartRequest(task: WorkspaceSuggestedTask): SuggestedTaskStartRequest {
  return {
    task,
    deleteSuggestionId: task.id,
  }
}

export function createInlineSuggestedTaskStartRequest(
  item: SuggestedTasksItem,
  task: WorkspaceSuggestedTask
): SuggestedTaskStartRequest {
  return {
    task,
    deleteSuggestionId: item.hasPersistedCopy ? task.id : undefined,
  }
}

export function getSuggestedTaskDedicatedFolderName(task: WorkspaceSuggestedTask): string | null {
  if (task.shouldCreateDedicatedFolder !== true) {
    return null
  }

  const folderName = task.dedicatedFolderName?.trim()
  return folderName || null
}

export function shouldRefreshWorkspaceSuggestedTasks(item: {
  type: string
  scope?: unknown
  status?: unknown
  hasPersistedCopy?: unknown
}): boolean {
  return (
    item.type === 'suggested_tasks' &&
    item.scope === 'global' &&
    item.status === 'completed' &&
    item.hasPersistedCopy === true
  )
}
