import { useCallback, useEffect, useRef } from 'react'
import type { CanvasItem } from 'shared'
import { getCanvasViewport } from '@/hooks/workspaceStorage'
import { resolveFocusModeTargetAction } from './focusModeNavigation'
import { exitFocusMode } from '@/store/useUIStore'
import { getAgentCanvasFollowRequestKey, type AgentCanvasFollowRequest } from '@/components/chat/agentFileFollow'

interface UseCanvasExternalFocusOptions {
  canvas: CanvasItem
  workspaceId: string
  selectedNodeId?: string | null
  selectedNodeIds: readonly string[]
  focusedNodeId?: string | null
  followRequest?: AgentCanvasFollowRequest | null
  fitSelectedNode: boolean
  suppressSelectedNodeFallbackFit?: boolean
  focusMode: boolean
  focusModeNodeId: string | null
  savedViewport: { x: number; y: number; zoom: number } | null
  enterFocusMode: (
    nodeId: string,
    nodeType: 'blockNote',
    viewport: { x: number; y: number; zoom: number },
    isSwitching?: boolean
  ) => void
  getViewport: () => { x: number; y: number; zoom: number }
  setViewport: (viewport: { x: number; y: number; zoom: number }, options?: { duration?: number }) => void
  fitNodeInView: (nodeId: string) => void
  followNodeInView: (nodeId: string) => { found: boolean }
  followSectionInView: (sectionId: string) => { found: boolean }
  focusNodeAt100: (nodeId: string) => { found: boolean; moved: boolean }
  setSelectedNodeIds: (nodeIds: string[]) => void
  onNodeFocused?: () => void
  onNodeFollowed?: () => void
}

const FOLLOW_RETRY_INTERVAL_MS = 100
const FOLLOW_RENDER_TIMEOUT_MS = 3_000

function areNodeIdArraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function useCanvasExternalFocus({
  canvas,
  workspaceId,
  selectedNodeId,
  selectedNodeIds,
  focusedNodeId,
  followRequest,
  fitSelectedNode,
  suppressSelectedNodeFallbackFit = false,
  focusMode,
  focusModeNodeId,
  savedViewport,
  enterFocusMode,
  getViewport,
  setViewport,
  fitNodeInView,
  followNodeInView,
  followSectionInView,
  focusNodeAt100,
  setSelectedNodeIds,
  onNodeFocused,
  onNodeFollowed,
}: UseCanvasExternalFocusOptions) {
  const completedFollowRequestKeyRef = useRef<string | null>(null)
  const selectedNodeIdsRef = useRef<readonly string[]>(selectedNodeIds)
  selectedNodeIdsRef.current = selectedNodeIds
  const setSelectedNodeIdsIfChanged = useCallback(
    (nodeIds: string[]) => {
      if (!areNodeIdArraysEqual(selectedNodeIdsRef.current, nodeIds)) {
        setSelectedNodeIds(nodeIds)
      }
    },
    [setSelectedNodeIds]
  )

  useEffect(() => {
    if (!selectedNodeId) {
      return
    }

    const item = canvas.items.find((candidate) => candidate.id === selectedNodeId)
    if (!item) {
      return
    }

    if (item.kind === 'node') {
      const focusModeAction = resolveFocusModeTargetAction({
        focusMode,
        focusedNodeId: focusModeNodeId,
        targetNodeId: selectedNodeId,
        targetNodeType: item.xynode.type,
      })

      if (focusModeAction.type === 'switch') {
        enterFocusMode(selectedNodeId, focusModeAction.nodeType, savedViewport || getViewport(), true)
        setSelectedNodeIdsIfChanged([selectedNodeId])
        onNodeFocused?.()
        return
      }

      if (focusModeAction.type === 'exit') {
        exitFocusMode()
      }
    }

    setSelectedNodeIdsIfChanged([selectedNodeId])

    const canvasViewport = getCanvasViewport(workspaceId, canvas.id)
    if (canvasViewport) {
      setViewport(canvasViewport, { duration: 0 })
    }

    if (fitSelectedNode || (!canvasViewport && !suppressSelectedNodeFallbackFit)) {
      requestAnimationFrame(() => {
        fitNodeInView(selectedNodeId)
        onNodeFocused?.()
      })
      return
    }

    onNodeFocused?.()
  }, [
    canvas,
    fitNodeInView,
    fitSelectedNode,
    focusMode,
    focusModeNodeId,
    getViewport,
    enterFocusMode,
    onNodeFocused,
    savedViewport,
    selectedNodeId,
    setSelectedNodeIdsIfChanged,
    setViewport,
    suppressSelectedNodeFallbackFit,
    workspaceId,
  ])

  useEffect(() => {
    if (!focusedNodeId) {
      return
    }

    const item = canvas.items.find((candidate) => candidate.id === focusedNodeId)
    if (!item) {
      return
    }

    if (item.kind === 'node') {
      const focusModeAction = resolveFocusModeTargetAction({
        focusMode,
        focusedNodeId: focusModeNodeId,
        targetNodeId: focusedNodeId,
        targetNodeType: item.xynode.type,
      })

      if (focusModeAction.type === 'switch') {
        enterFocusMode(focusedNodeId, focusModeAction.nodeType, savedViewport || getViewport(), true)
        setSelectedNodeIdsIfChanged([focusedNodeId])
        onNodeFocused?.()
        return
      }

      if (focusModeAction.type === 'exit') {
        exitFocusMode()
      }
    }

    setSelectedNodeIdsIfChanged([focusedNodeId])

    requestAnimationFrame(() => {
      const result = focusNodeAt100(focusedNodeId)
      if (!result.found) {
        setTimeout(() => {
          focusNodeAt100(focusedNodeId)
          onNodeFocused?.()
        }, 100)
        return
      }

      onNodeFocused?.()
    })
  }, [
    canvas,
    focusMode,
    focusModeNodeId,
    focusedNodeId,
    focusNodeAt100,
    getViewport,
    enterFocusMode,
    onNodeFocused,
    savedViewport,
    setSelectedNodeIdsIfChanged,
  ])

  useEffect(() => {
    if (!followRequest) {
      completedFollowRequestKeyRef.current = null
      return
    }

    const request = followRequest
    const requestKey = getAgentCanvasFollowRequestKey(request)
    if (completedFollowRequestKeyRef.current === requestKey) {
      return
    }

    let cancelled = false
    let frameId: number | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let hasPreparedCanvas = false
    const startedAt = Date.now()

    const finish = () => {
      if (!cancelled) {
        completedFollowRequestKeyRef.current = requestKey
        onNodeFollowed?.()
      }
    }

    const followTarget = request.viewportTarget
    if (followTarget.type === 'node' && followTarget.nodeId !== request.selectedNodeId) {
      finish()
      return
    }

    function scheduleAttempt() {
      if (Date.now() - startedAt >= FOLLOW_RENDER_TIMEOUT_MS) {
        finish()
        return
      }

      timeoutId = setTimeout(attemptFollow, FOLLOW_RETRY_INTERVAL_MS)
    }

    function attemptFollow() {
      if (cancelled) {
        return
      }

      const selectedItem = canvas.items.find((candidate) => candidate.id === request.selectedNodeId)
      const sectionExists =
        followTarget.type !== 'section' || canvas.sections?.some((section) => section.id === followTarget.sectionId)

      if (!selectedItem || !sectionExists) {
        scheduleAttempt()
        return
      }

      if (!hasPreparedCanvas) {
        if (focusMode) {
          exitFocusMode()
        }

        setSelectedNodeIdsIfChanged([request.selectedNodeId])
        hasPreparedCanvas = true
      }

      frameId = requestAnimationFrame(() => {
        if (cancelled) {
          return
        }

        const result =
          followTarget.type === 'section'
            ? followSectionInView(followTarget.sectionId)
            : followNodeInView(followTarget.nodeId)

        if (result.found) {
          finish()
          return
        }

        scheduleAttempt()
      })
    }

    attemptFollow()

    return () => {
      cancelled = true
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }
    }
  }, [
    canvas.items,
    canvas.sections,
    followNodeInView,
    followRequest,
    followSectionInView,
    focusMode,
    onNodeFollowed,
    setSelectedNodeIdsIfChanged,
  ])
}
