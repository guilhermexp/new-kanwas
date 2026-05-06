import { useCallback, useEffect, useRef } from 'react'
import type { CanvasItem } from 'shared'
import { findCanvasById, resolveWorkspacePath } from '@/lib/workspaceUtils'
import {
  collectLiveAgentCanvasFollowTargets,
  createAgentCanvasFollowRequest,
  getAgentCanvasFollowRequestKey,
  type AgentCanvasFollowRequest,
  type AgentFileFollowBatchTarget,
  type AgentFileFollowCandidate,
} from './agentFileFollow'
import type { AgentInvocationUiOptions } from '@/providers/chat/invocationOptions'

export const AGENT_FOLLOW_DEBOUNCE_MS = 120
export const AGENT_FOLLOW_MAX_DELAY_MS = 500

interface PendingAgentFollowBatch {
  targetsByItemId: Map<string, AgentFileFollowBatchTarget>
  openedAt: number
}

interface UseAgentCanvasFollowOptions {
  workspaceId: string
  activeTaskId?: string | null
  invocationId?: string | null
  activeInvocationOptions?: AgentInvocationUiOptions | null
  items: readonly AgentFileFollowCandidate[]
  root?: CanvasItem | null
  activeCanvasId: string | null
  onFollowRequest?: (request: AgentCanvasFollowRequest) => void
}

function isTextEditorFollowCandidate(item: AgentFileFollowCandidate): boolean {
  return item.type === 'text_editor'
}

function markSettledFollowItemsHandled(
  items: readonly AgentFileFollowCandidate[],
  handledItemIds: Set<string>,
  pendingResolutionItemIds: Set<string>
) {
  for (const item of items) {
    if (isTextEditorFollowCandidate(item) && item.status !== 'executing') {
      handledItemIds.add(item.id)
      pendingResolutionItemIds.delete(item.id)
    }
  }
}

function findFollowTargetSectionId(root: CanvasItem, target: AgentFileFollowBatchTarget): string | null {
  const canvas = findCanvasById(root, target.canvasId)
  return canvas?.sections?.find((section) => section.memberIds.includes(target.nodeId))?.id ?? null
}

export function useAgentCanvasFollow({
  workspaceId,
  activeTaskId,
  invocationId,
  activeInvocationOptions,
  items,
  root,
  activeCanvasId,
  onFollowRequest,
}: UseAgentCanvasFollowOptions) {
  const scopeKey = `${workspaceId}:${activeTaskId ?? 'none'}:${invocationId ?? 'none'}`
  const enabled = activeInvocationOptions?.follow === true
  const handledItemIdsRef = useRef<Set<string>>(new Set())
  const pendingResolutionItemIdsRef = useRef<Set<string>>(new Set())
  const previousEnabledRef = useRef(false)
  const scopeKeyRef = useRef<string | null>(null)
  const lastRequestKeyRef = useRef<string | null>(null)
  const pendingBatchRef = useRef<PendingAgentFollowBatch | null>(null)
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushContextRef = useRef<{
    root: CanvasItem | null
    onFollowRequest?: (request: AgentCanvasFollowRequest) => void
  }>({
    root: null,
    onFollowRequest,
  })

  flushContextRef.current = {
    root: root ?? null,
    onFollowRequest,
  }

  const clearTimers = useCallback(() => {
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current)
      debounceTimeoutRef.current = null
    }

    if (maxTimeoutRef.current) {
      clearTimeout(maxTimeoutRef.current)
      maxTimeoutRef.current = null
    }
  }, [])

  const flushPendingBatch = useCallback(() => {
    const batch = pendingBatchRef.current
    pendingBatchRef.current = null
    clearTimers()

    if (!batch) {
      return
    }

    const { root: currentRoot, onFollowRequest: currentOnFollowRequest } = flushContextRef.current
    if (!currentOnFollowRequest) {
      return
    }

    const request = createAgentCanvasFollowRequest(Array.from(batch.targetsByItemId.values()), {
      getSectionId: (target) =>
        currentRoot ? findFollowTargetSectionId(currentRoot, target) : (target.sectionId ?? null),
    })
    if (!request) {
      return
    }

    const requestKey = getAgentCanvasFollowRequestKey(request)
    if (requestKey === lastRequestKeyRef.current) {
      return
    }

    lastRequestKeyRef.current = requestKey
    currentOnFollowRequest(request)
  }, [clearTimers])

  const resetPendingBatch = useCallback(() => {
    pendingBatchRef.current = null
    clearTimers()
  }, [clearTimers])

  const resetFollowState = useCallback(() => {
    handledItemIdsRef.current.clear()
    pendingResolutionItemIdsRef.current.clear()
    resetPendingBatch()
    lastRequestKeyRef.current = null
  }, [resetPendingBatch])

  const scheduleFlush = useCallback(
    (options: { hasUnresolvedFollowCandidate: boolean; resetDebounce: boolean }) => {
      const batch = pendingBatchRef.current
      if (!batch) {
        return
      }

      if (options.resetDebounce || options.hasUnresolvedFollowCandidate) {
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current)
          debounceTimeoutRef.current = null
        }
      }

      if (!maxTimeoutRef.current) {
        const elapsedMs = Date.now() - batch.openedAt
        maxTimeoutRef.current = setTimeout(flushPendingBatch, Math.max(0, AGENT_FOLLOW_MAX_DELAY_MS - elapsedMs))
      }

      if (options.hasUnresolvedFollowCandidate) {
        return
      }

      if (options.resetDebounce || !debounceTimeoutRef.current) {
        debounceTimeoutRef.current = setTimeout(flushPendingBatch, AGENT_FOLLOW_DEBOUNCE_MS)
      }
    },
    [flushPendingBatch]
  )

  const queueTargets = useCallback(
    (targets: readonly AgentFileFollowBatchTarget[], hasUnresolvedFollowCandidate: boolean) => {
      let batch = pendingBatchRef.current
      const hasNewTargets = targets.length > 0

      if (hasNewTargets && !batch) {
        batch = {
          targetsByItemId: new Map(),
          openedAt: Date.now(),
        }
        pendingBatchRef.current = batch
      }

      if (!batch) {
        return
      }

      for (const target of targets) {
        batch.targetsByItemId.delete(target.itemId)
        batch.targetsByItemId.set(target.itemId, target)
      }

      scheduleFlush({
        hasUnresolvedFollowCandidate,
        resetDebounce: hasNewTargets,
      })
    },
    [scheduleFlush]
  )

  useEffect(() => resetPendingBatch, [resetPendingBatch])

  useEffect(() => {
    const handledItemIds = handledItemIdsRef.current
    const pendingResolutionItemIds = pendingResolutionItemIdsRef.current
    const wasEnabled = previousEnabledRef.current
    previousEnabledRef.current = enabled

    if (scopeKeyRef.current !== scopeKey) {
      resetFollowState()
      scopeKeyRef.current = scopeKey
    }

    if (!enabled || !onFollowRequest) {
      lastRequestKeyRef.current = null
      resetPendingBatch()
      markSettledFollowItemsHandled(items, handledItemIds, pendingResolutionItemIds)
      return
    }

    if (!wasEnabled) {
      markSettledFollowItemsHandled(items, handledItemIds, pendingResolutionItemIds)
    }

    if (!root) {
      return
    }

    const result = collectLiveAgentCanvasFollowTargets({
      enabled,
      items,
      activeCanvasId,
      handledItemIds,
      pendingResolutionItemIds,
      resolveTarget: (path) => resolveWorkspacePath(root, path),
    })

    for (const itemId of result.handledItemIds) {
      handledItemIds.add(itemId)
      pendingResolutionItemIds.delete(itemId)
    }

    for (const itemId of result.unresolvedItemIds) {
      pendingResolutionItemIds.add(itemId)
    }

    queueTargets(result.followTargets, result.hasUnresolvedFollowCandidate)
  }, [
    activeCanvasId,
    enabled,
    items,
    onFollowRequest,
    queueTargets,
    resetFollowState,
    resetPendingBatch,
    root,
    scopeKey,
  ])
}
