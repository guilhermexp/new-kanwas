import type { TextEditorItem } from 'backend/agent'

export type AgentFileFollowOperation = 'write' | 'edit'

export interface AgentFileFollowTarget {
  nodeId: string
  canvasId: string
  sectionId?: string | null
}

export interface AgentFileFollowCandidate {
  id: string
  type: string
  toolName?: string
  command?: string
  path?: string
  animationKey?: string
  status?: string
}

export type AgentFileFollowDecision =
  | {
      type: 'none'
      shouldMarkHandled: boolean
    }
  | {
      type: 'follow'
      shouldMarkHandled: true
      itemId: string
      operation: AgentFileFollowOperation
      nodeId: string
      canvasId: string
      sectionId: string | null
      switchCanvas: boolean
    }

export type AgentCanvasFollowViewportTarget =
  | {
      type: 'node'
      nodeId: string
    }
  | {
      type: 'section'
      sectionId: string
    }

export interface AgentCanvasFollowRequest {
  canvasId: string
  selectedNodeId: string
  viewportTarget: AgentCanvasFollowViewportTarget
}

export interface AgentFileFollowBatchTarget {
  itemId: string
  operation: AgentFileFollowOperation
  nodeId: string
  canvasId: string
  sectionId?: string | null
}

export interface LiveAgentCanvasFollowTargets {
  followTargets: AgentFileFollowBatchTarget[]
  handledItemIds: string[]
  unresolvedItemIds: string[]
  hasUnresolvedFollowCandidate: boolean
}

export function getAgentFileFollowPath(item: Pick<TextEditorItem, 'path' | 'animationKey'>): string {
  return item.animationKey ?? item.path
}

function getAgentFileFollowOperation(
  item: Pick<AgentFileFollowCandidate, 'command' | 'toolName'>
): AgentFileFollowOperation | null {
  if (item.command === 'create') {
    return 'write'
  }

  if (item.command === 'str_replace' || item.command === 'insert') {
    return 'edit'
  }

  if (item.toolName === 'write_file') {
    return 'write'
  }

  if (item.toolName === 'edit_file' || item.toolName === 'str_replace_based_edit_tool') {
    return 'edit'
  }

  return null
}

export function evaluateAgentFileFollow(options: {
  enabled: boolean
  item: AgentFileFollowCandidate
  resolved: AgentFileFollowTarget | null
  activeCanvasId: string | null
  handledItemIds: ReadonlySet<string>
}): AgentFileFollowDecision {
  const { enabled, item, resolved, activeCanvasId, handledItemIds } = options

  if (!enabled || handledItemIds.has(item.id) || item.type !== 'text_editor') {
    return { type: 'none', shouldMarkHandled: false }
  }

  const operation = getAgentFileFollowOperation(item)
  if (!operation || item.status === 'failed') {
    return { type: 'none', shouldMarkHandled: true }
  }

  if (!resolved || !activeCanvasId) {
    return { type: 'none', shouldMarkHandled: false }
  }

  const isOutsideActiveCanvas = resolved.canvasId !== activeCanvasId
  if (operation === 'edit' && isOutsideActiveCanvas) {
    return { type: 'none', shouldMarkHandled: true }
  }

  return {
    type: 'follow',
    shouldMarkHandled: true,
    itemId: item.id,
    operation,
    nodeId: resolved.nodeId,
    canvasId: resolved.canvasId,
    sectionId: resolved.sectionId ?? null,
    switchCanvas: isOutsideActiveCanvas,
  }
}

export function createAgentFileFollowBatchTarget(
  decision: Extract<AgentFileFollowDecision, { type: 'follow' }>
): AgentFileFollowBatchTarget {
  return {
    itemId: decision.itemId,
    operation: decision.operation,
    nodeId: decision.nodeId,
    canvasId: decision.canvasId,
  }
}

export function createAgentCanvasFollowRequest(
  targets: readonly AgentFileFollowBatchTarget[],
  options?: {
    getSectionId?: (target: AgentFileFollowBatchTarget) => string | null
  }
): AgentCanvasFollowRequest | null {
  const latestTarget = targets[targets.length - 1]
  if (!latestTarget) {
    return null
  }

  const getSectionId = options?.getSectionId ?? ((target: AgentFileFollowBatchTarget) => target.sectionId ?? null)
  const targetsWithSections = targets.map((target) => ({
    target,
    sectionId: getSectionId(target),
  }))
  const firstSectionId = targetsWithSections[0].sectionId
  const firstCanvasId = targets[0].canvasId
  const hasWrite = targets.some((target) => target.operation === 'write')
  const shouldFollowSection =
    targets.length >= 2 &&
    hasWrite &&
    Boolean(firstSectionId) &&
    targetsWithSections.every(
      ({ target, sectionId }) => target.canvasId === firstCanvasId && sectionId === firstSectionId
    )

  if (shouldFollowSection) {
    return {
      canvasId: latestTarget.canvasId,
      selectedNodeId: latestTarget.nodeId,
      viewportTarget: {
        type: 'section',
        sectionId: firstSectionId!,
      },
    }
  }

  return {
    canvasId: latestTarget.canvasId,
    selectedNodeId: latestTarget.nodeId,
    viewportTarget: {
      type: 'node',
      nodeId: latestTarget.nodeId,
    },
  }
}

export function getAgentCanvasFollowRequestKey(request: AgentCanvasFollowRequest): string {
  return JSON.stringify([
    request.canvasId,
    request.selectedNodeId,
    request.viewportTarget.type,
    request.viewportTarget.type === 'section' ? request.viewportTarget.sectionId : request.viewportTarget.nodeId,
  ])
}

export function collectLiveAgentCanvasFollowTargets(options: {
  enabled: boolean
  items: readonly AgentFileFollowCandidate[]
  activeCanvasId: string | null
  handledItemIds: ReadonlySet<string>
  pendingResolutionItemIds?: ReadonlySet<string>
  resolveTarget: (path: string, item: AgentFileFollowCandidate) => AgentFileFollowTarget | null
}): LiveAgentCanvasFollowTargets {
  const handledItemIds: string[] = []
  const unresolvedItemIds: string[] = []
  const followTargets: AgentFileFollowBatchTarget[] = []
  let hasUnresolvedFollowCandidate = false

  if (!options.enabled) {
    return {
      followTargets,
      handledItemIds,
      unresolvedItemIds,
      hasUnresolvedFollowCandidate,
    }
  }

  for (const item of options.items) {
    if (options.handledItemIds.has(item.id) || item.type !== 'text_editor') {
      continue
    }

    const operation = getAgentFileFollowOperation(item)
    if (!operation || item.status === 'failed') {
      handledItemIds.push(item.id)
      continue
    }

    const canRetrySettledItem = options.pendingResolutionItemIds?.has(item.id) === true
    if (item.status !== 'executing' && !canRetrySettledItem) {
      handledItemIds.push(item.id)
      continue
    }

    if (!item.path) {
      if (item.status === 'executing') {
        unresolvedItemIds.push(item.id)
        hasUnresolvedFollowCandidate = true
      } else {
        handledItemIds.push(item.id)
      }
      continue
    }

    const resolved = options.resolveTarget(
      getAgentFileFollowPath({ path: item.path, animationKey: item.animationKey }),
      item
    )
    const decision = evaluateAgentFileFollow({
      enabled: options.enabled,
      item,
      resolved,
      activeCanvasId: options.activeCanvasId,
      handledItemIds: options.handledItemIds,
    })

    if (decision.shouldMarkHandled) {
      handledItemIds.push(item.id)
    }

    if (!resolved && !decision.shouldMarkHandled) {
      unresolvedItemIds.push(item.id)
      hasUnresolvedFollowCandidate = true
    }

    if (decision.type === 'follow') {
      followTargets.push(createAgentFileFollowBatchTarget(decision))
    }
  }

  return {
    followTargets,
    handledItemIds,
    unresolvedItemIds,
    hasUnresolvedFollowCandidate,
  }
}
