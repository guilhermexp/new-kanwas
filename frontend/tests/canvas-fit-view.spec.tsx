import React, { useCallback, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasItem, NodeItem } from 'shared'
import {
  calculateCanvasFitViewport,
  collectRenderedNodeBounds,
  type CanvasFitItemBounds,
  type CanvasFitVisibleArea,
} from '@/components/canvas/canvasFitView'
import { calculateFollowNodeViewport, calculateFollowSectionViewport } from '@/components/canvas/hooks'
import { useCanvasExternalFocus } from '@/components/canvas/useCanvasExternalFocus'
import { useCanvasViewportState } from '@/components/canvas/useCanvasViewportState'
import { useInitialCanvasFitRequest } from '@/components/canvas/useInitialCanvasFitRequest'
import { CANVAS } from '@/components/canvas/constants'
import { ui } from '@/store/useUIStore'
import type { AgentCanvasFollowRequest } from '@/components/chat/agentFileFollow'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const getCanvasViewportMock = vi.fn()
const setCanvasViewportMock = vi.fn()

vi.mock('@/hooks/workspaceStorage', () => ({
  getCanvasViewport: (...args: unknown[]) => getCanvasViewportMock(...args),
  setCanvasViewport: (...args: unknown[]) => setCanvasViewportMock(...args),
}))

vi.mock('@/lib/CursorManager', () => ({
  default: class CursorManagerMock {
    attach() {}
    destroy() {}
    refresh() {}
    setReactFlowInstance() {}
  },
}))

function createNode(id: string, x: number, y: number): NodeItem {
  return {
    kind: 'node',
    id,
    name: id,
    xynode: {
      id,
      type: 'blockNote',
      position: { x, y },
      data: {},
    },
  }
}

function createCanvas(items: Array<CanvasItem | NodeItem>, sections?: CanvasItem['sections']): CanvasItem {
  return {
    kind: 'canvas',
    id: 'canvas-1',
    name: 'Canvas 1',
    xynode: {
      id: 'canvas-1',
      type: 'canvas',
      position: { x: 0, y: 0 },
      data: {},
    },
    edges: [],
    items,
    sections,
  }
}

function FolderOpenFitProbe({
  canvas,
  selectedNodeId,
  fitCanvasRequestKey,
  getNode,
  setViewport,
  fitNodeInView,
  onFitCanvasRequestHandled,
  renderedNodeIds,
}: {
  canvas: CanvasItem
  selectedNodeId: string
  fitCanvasRequestKey: string
  renderedNodeIds?: string[]
  getNode: (nodeId: string) => {
    position: { x: number; y: number }
    measured?: { width?: number; height?: number }
    width?: number
    height?: number
    style?: { width?: number | string; height?: number | string }
  } | null
  setViewport: ReturnType<typeof vi.fn>
  fitNodeInView: ReturnType<typeof vi.fn>
  onFitCanvasRequestHandled: ReturnType<typeof vi.fn>
}) {
  const canvasSurfaceRef = useRef<HTMLDivElement>(null)

  useCanvasViewportState({
    workspaceId: 'workspace-1',
    canvasId: canvas.id,
    selectedNodeId,
    focusedNodeId: null,
    deferDefaultViewportRestore: true,
    focusMode: false,
    savedViewport: null,
    provider: {} as never,
    localUserId: 'user-1',
    isCursorPresenceSuppressed: () => false,
    acquireCursorPresenceSuppression: () => () => undefined,
    screenToFlowPosition: (() => ({ x: 0, y: 0 })) as never,
    flowToScreenPosition: (() => ({ x: 0, y: 0 })) as never,
    setViewport: setViewport as never,
    canvasSurfaceRef,
  })

  useInitialCanvasFitRequest({
    workspaceId: 'workspace-1',
    canvasId: canvas.id,
    canvasItems: canvas.items,
    renderedNodeIds: renderedNodeIds ?? canvas.items.map((item) => item.id),
    fitCanvasRequestKey,
    getNode: ((nodeId: string) => getNode(nodeId)) as never,
    setViewport: setViewport as never,
    onFitCanvasRequestHandled,
  })

  useCanvasExternalFocus({
    canvas,
    workspaceId: 'workspace-1',
    selectedNodeId,
    selectedNodeIds: selectedNodeId ? [selectedNodeId] : [],
    focusedNodeId: null,
    followRequest: null,
    fitSelectedNode: false,
    suppressSelectedNodeFallbackFit: true,
    focusMode: false,
    focusModeNodeId: null,
    savedViewport: null,
    enterFocusMode: (() => undefined) as never,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: setViewport as never,
    fitNodeInView,
    followNodeInView: () => ({ found: false }),
    followSectionInView: () => ({ found: false }),
    focusNodeAt100: () => ({ found: false, moved: false }),
    setSelectedNodeIds: () => undefined,
    onNodeFocused: () => undefined,
  })

  return <div ref={canvasSurfaceRef} />
}

function ExternalFocusFollowProbe({
  canvas,
  followRequest,
  followNodeInView,
  followSectionInView,
  selectedNodeIds = [],
  setSelectedNodeIds,
  onNodeFollowed,
}: {
  canvas: CanvasItem
  followRequest: AgentCanvasFollowRequest | null
  followNodeInView: (nodeId: string) => { found: boolean }
  followSectionInView?: (sectionId: string) => { found: boolean }
  selectedNodeIds?: string[]
  setSelectedNodeIds?: (nodeIds: string[]) => void
  onNodeFollowed?: () => void
}) {
  useCanvasExternalFocus({
    canvas,
    workspaceId: 'workspace-1',
    selectedNodeId: null,
    selectedNodeIds,
    focusedNodeId: null,
    followRequest,
    fitSelectedNode: false,
    suppressSelectedNodeFallbackFit: true,
    focusMode: false,
    focusModeNodeId: null,
    savedViewport: null,
    enterFocusMode: (() => undefined) as never,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: () => undefined,
    fitNodeInView: () => undefined,
    followNodeInView,
    followSectionInView: followSectionInView ?? (() => ({ found: false })),
    focusNodeAt100: () => ({ found: false, moved: false }),
    setSelectedNodeIds: setSelectedNodeIds ?? (() => undefined),
    onNodeFocused: () => undefined,
    onNodeFollowed,
  })

  return null
}

function FitThenFollowProbe({
  canvas,
  request,
  initialFitRequestKey,
  getNode,
  setViewport,
  followNodeInView,
  setSelectedNodeIds,
  onFitCanvasRequestHandled,
  onNodeFollowed,
}: {
  canvas: CanvasItem
  request: AgentCanvasFollowRequest
  initialFitRequestKey: string
  getNode: (nodeId: string) => {
    position: { x: number; y: number }
    measured?: { width?: number; height?: number }
    width?: number
    height?: number
    style?: { width?: number | string; height?: number | string }
  } | null
  setViewport: ReturnType<typeof vi.fn>
  followNodeInView: (nodeId: string) => { found: boolean }
  setSelectedNodeIds?: (nodeIds: string[]) => void
  onFitCanvasRequestHandled?: (requestKey: string) => void
  onNodeFollowed?: () => void
}) {
  const [fitRequestKey, setFitRequestKey] = useState<string | null>(initialFitRequestKey)
  const [followRequest, setFollowRequest] = useState<AgentCanvasFollowRequest | null>(null)
  const pendingFollowRef = useRef<{ fitRequestKey: string; request: AgentCanvasFollowRequest } | null>({
    fitRequestKey: initialFitRequestKey,
    request,
  })

  const handleFitCanvasRequestHandled = useCallback(
    (requestKey: string) => {
      setFitRequestKey((currentKey) => (currentKey === requestKey ? null : currentKey))
      onFitCanvasRequestHandled?.(requestKey)

      if (pendingFollowRef.current?.fitRequestKey === requestKey) {
        const nextFollowRequest = pendingFollowRef.current.request
        pendingFollowRef.current = null
        setFollowRequest(nextFollowRequest)
      }
    },
    [onFitCanvasRequestHandled]
  )

  useInitialCanvasFitRequest({
    workspaceId: 'workspace-1',
    canvasId: canvas.id,
    canvasItems: canvas.items,
    renderedNodeIds: canvas.items.map((item) => item.id),
    fitCanvasRequestKey: fitRequestKey,
    getNode: ((nodeId: string) => getNode(nodeId)) as never,
    setViewport: setViewport as never,
    onFitCanvasRequestHandled: handleFitCanvasRequestHandled,
  })

  useCanvasExternalFocus({
    canvas,
    workspaceId: 'workspace-1',
    selectedNodeId: null,
    selectedNodeIds: [],
    focusedNodeId: null,
    followRequest,
    fitSelectedNode: false,
    suppressSelectedNodeFallbackFit: true,
    focusMode: false,
    focusModeNodeId: null,
    savedViewport: null,
    enterFocusMode: (() => undefined) as never,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: () => undefined,
    fitNodeInView: () => undefined,
    followNodeInView,
    followSectionInView: () => ({ found: false }),
    focusNodeAt100: () => ({ found: false, moved: false }),
    setSelectedNodeIds: setSelectedNodeIds ?? (() => undefined),
    onNodeFocused: () => undefined,
    onNodeFollowed: () => {
      setFollowRequest(null)
      onNodeFollowed?.()
    },
  })

  return null
}

describe('canvas fit view', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  let originalInnerWidth = 0
  let originalInnerHeight = 0
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame

  beforeEach(() => {
    getCanvasViewportMock.mockReset()
    setCanvasViewportMock.mockReset()
    ui.sidebarOpen = true
    ui.zenMode = false
    ui.fullScreenMode = false
    ui.chatWidth = 480
    ui.sidebarWidth = 220

    originalInnerWidth = window.innerWidth
    originalInnerHeight = window.innerHeight
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })

    vi.useFakeTimers()
    originalRequestAnimationFrame = window.requestAnimationFrame
    originalCancelAnimationFrame = window.cancelAnimationFrame
    window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)) as typeof window.requestAnimationFrame
    window.cancelAnimationFrame = ((handle: number) =>
      window.clearTimeout(handle)) as typeof window.cancelAnimationFrame
  })

  afterEach(() => {
    if (root && container) {
      act(() => {
        root?.unmount()
      })
      container.remove()
    }

    root = null
    container = null
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    window.requestAnimationFrame = originalRequestAnimationFrame
    window.cancelAnimationFrame = originalCancelAnimationFrame
    vi.useRealTimers()
  })

  it('returns null for empty bounds', () => {
    const visibleArea: CanvasFitVisibleArea = {
      availableWidth: 900,
      availableHeight: 700,
      centerX: 450,
      centerY: 350,
    }

    expect(calculateCanvasFitViewport([], visibleArea)).toBeNull()
  })

  it('fits and centers multiple bounds inside the visible area', () => {
    const bounds: CanvasFitItemBounds[] = [
      { x: 100, y: 120, width: 300, height: 200 },
      { x: 760, y: 420, width: 240, height: 160 },
    ]
    const visibleArea: CanvasFitVisibleArea = {
      availableWidth: 900,
      availableHeight: 900,
      centerX: 450,
      centerY: 450,
    }

    const viewport = calculateCanvasFitViewport(bounds, visibleArea)

    expect(viewport).not.toBeNull()
    expect(viewport?.zoom).toBeCloseTo(700 / 900, 5)
    expect(viewport?.x).toBeCloseTo(22.22222, 4)
    expect(viewport?.y).toBeCloseTo(177.77778, 4)
  })

  it('clamps fit zoom to the maximum zoom level', () => {
    const bounds: CanvasFitItemBounds[] = [{ x: 100, y: 100, width: 40, height: 30 }]
    const visibleArea: CanvasFitVisibleArea = {
      availableWidth: 1600,
      availableHeight: 900,
      centerX: 800,
      centerY: 450,
    }

    const viewport = calculateCanvasFitViewport(bounds, visibleArea)

    expect(viewport?.zoom).toBe(2)
  })

  it('clamps fit zoom to the minimum zoom level', () => {
    const bounds: CanvasFitItemBounds[] = [{ x: 100, y: 100, width: 20000, height: 8000 }]
    const visibleArea: CanvasFitVisibleArea = {
      availableWidth: 900,
      availableHeight: 700,
      centerX: 450,
      centerY: 350,
    }

    const viewport = calculateCanvasFitViewport(bounds, visibleArea)

    expect(viewport?.zoom).toBe(0.1)
  })

  it('places follow node center forty percent from the top', () => {
    const viewport = calculateFollowNodeViewport(
      {
        position: { x: 100, y: 200 },
        measured: { width: 300, height: 180 },
      },
      { centerX: 800, centerY: 450 },
      { x: 0, y: 0, zoom: 1.4 }
    )

    expect(viewport.zoom).toBeCloseTo(2 / 3, 5)
    expect(viewport.x).toBeCloseTo(633.33333, 5)
    expect(viewport.y).toBeCloseTo(166.66667, 5)
    expect(viewport.y + (200 + 180 / 2) * viewport.zoom).toBeCloseTo(360, 5)
  })

  it('uses follow target zoom regardless of current node viewport zoom', () => {
    const viewport = calculateFollowNodeViewport(
      {
        position: { x: 100, y: 200 },
        measured: { width: 300, height: 180 },
      },
      { centerX: 800, centerY: 450 },
      { x: 0, y: 0, zoom: 0.5 }
    )

    expect(viewport.zoom).toBeCloseTo(2 / 3, 5)
  })

  it('caps section follow zoom at the 50% farther-away zoom', () => {
    const viewport = calculateFollowSectionViewport(
      { x: 100, y: 100, width: 100, height: 80 },
      {
        availableWidth: 1200,
        availableHeight: 800,
        centerX: 600,
        centerY: 400,
      }
    )

    expect(viewport?.zoom).toBeCloseTo(2 / 3, 5)
    expect(viewport?.x).toBeCloseTo(500, 5)
    expect(viewport?.y).toBeCloseTo(306.66667, 5)
  })

  it('zooms out to fit large sections', () => {
    const viewport = calculateFollowSectionViewport(
      { x: 0, y: 0, width: 2000, height: 1000 },
      {
        availableWidth: 1000,
        availableHeight: 800,
        centerX: 500,
        centerY: 400,
      }
    )

    expect(viewport?.zoom).toBeCloseTo(0.404, 5)
    expect(viewport?.x).toBeCloseTo(96, 5)
    expect(viewport?.y).toBeCloseTo(198, 5)
  })

  it('collects bounds for rendered synthetic canvas nodes', () => {
    const bounds = collectRenderedNodeBounds(['section-1'], () => ({
      position: { x: 80, y: 40 },
      style: { width: 1200, height: 520 },
    }))

    expect(bounds).toEqual([{ x: 80, y: 40, width: 1200, height: 520 }])
  })

  it('runs a follow request once even when the same request rerenders', async () => {
    const request: AgentCanvasFollowRequest = {
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: { type: 'node', nodeId: 'node-1' },
    }
    const followNodeInView = vi.fn(() => ({ found: true }))
    const setSelectedNodeIds = vi.fn()
    const onNodeFollowed = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas([createNode('node-1', 100, 120)])}
          followRequest={request}
          followNodeInView={followNodeInView}
          setSelectedNodeIds={setSelectedNodeIds}
          onNodeFollowed={onNodeFollowed}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    expect(setSelectedNodeIds).toHaveBeenCalledWith(['node-1'])
    expect(followNodeInView).toHaveBeenCalledTimes(1)
    expect(onNodeFollowed).toHaveBeenCalledTimes(1)

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas([createNode('node-1', 100, 120), createNode('node-2', 400, 120)])}
          followRequest={request}
          followNodeInView={followNodeInView}
          setSelectedNodeIds={setSelectedNodeIds}
          onNodeFollowed={onNodeFollowed}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(followNodeInView).toHaveBeenCalledTimes(1)
    expect(onNodeFollowed).toHaveBeenCalledTimes(1)
  })

  it('does not rewrite selection when the followed node is already selected', async () => {
    const request: AgentCanvasFollowRequest = {
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: { type: 'node', nodeId: 'node-1' },
    }
    const followNodeInView = vi.fn(() => ({ found: true }))
    const setSelectedNodeIds = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas([createNode('node-1', 100, 120)])}
          followRequest={request}
          followNodeInView={followNodeInView}
          selectedNodeIds={['node-1']}
          setSelectedNodeIds={setSelectedNodeIds}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    expect(followNodeInView).toHaveBeenCalledWith('node-1')
    expect(setSelectedNodeIds).not.toHaveBeenCalled()
  })

  it('can run the same follow target again after the request is cleared', async () => {
    const firstRequest: AgentCanvasFollowRequest = {
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: { type: 'node', nodeId: 'node-1' },
    }
    const secondRequest: AgentCanvasFollowRequest = {
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: { type: 'node', nodeId: 'node-1' },
    }
    const followNodeInView = vi.fn(() => ({ found: true }))

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas([createNode('node-1', 100, 120)])}
          followRequest={firstRequest}
          followNodeInView={followNodeInView}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas([createNode('node-1', 100, 120)])}
          followRequest={null}
          followNodeInView={followNodeInView}
        />
      )
    })

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas([createNode('node-1', 100, 120)])}
          followRequest={secondRequest}
          followNodeInView={followNodeInView}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    expect(followNodeInView).toHaveBeenCalledTimes(2)
  })

  it('waits for a followed node to appear before moving the viewport', async () => {
    const request: AgentCanvasFollowRequest = {
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: { type: 'node', nodeId: 'node-1' },
    }
    const followNodeInView = vi.fn(() => ({ found: true }))
    const onNodeFollowed = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas([])}
          followRequest={request}
          followNodeInView={followNodeInView}
          onNodeFollowed={onNodeFollowed}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })

    expect(followNodeInView).not.toHaveBeenCalled()
    expect(onNodeFollowed).not.toHaveBeenCalled()

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas([createNode('node-1', 100, 120)])}
          followRequest={request}
          followNodeInView={followNodeInView}
          onNodeFollowed={onNodeFollowed}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    expect(followNodeInView).toHaveBeenCalledWith('node-1')
    expect(onNodeFollowed).toHaveBeenCalledTimes(1)
  })

  it('clears a follow request after timing out waiting for the rendered node', async () => {
    const request: AgentCanvasFollowRequest = {
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: { type: 'node', nodeId: 'node-1' },
    }
    const followNodeInView = vi.fn(() => ({ found: false }))
    const onNodeFollowed = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas([createNode('node-1', 100, 120)])}
          followRequest={request}
          followNodeInView={followNodeInView}
          onNodeFollowed={onNodeFollowed}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(3_200)
      await Promise.resolve()
    })

    expect(followNodeInView).toHaveBeenCalled()
    expect(onNodeFollowed).toHaveBeenCalledTimes(1)
  })

  it('follows a section target after the section exists', async () => {
    const request: AgentCanvasFollowRequest = {
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: { type: 'section', sectionId: 'section-1' },
    }
    const followNodeInView = vi.fn(() => ({ found: false }))
    const followSectionInView = vi.fn(() => ({ found: true }))
    const onNodeFollowed = vi.fn()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <ExternalFocusFollowProbe
          canvas={createCanvas(
            [createNode('node-1', 100, 120)],
            [
              {
                id: 'section-1',
                title: 'Section',
                layout: 'horizontal',
                position: { x: 80, y: 80 },
                memberIds: ['node-1'],
              },
            ]
          )}
          followRequest={request}
          followNodeInView={followNodeInView}
          followSectionInView={followSectionInView}
          onNodeFollowed={onNodeFollowed}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    expect(followSectionInView).toHaveBeenCalledWith('section-1')
    expect(followNodeInView).not.toHaveBeenCalled()
    expect(onNodeFollowed).toHaveBeenCalledTimes(1)
  })

  it('runs normal canvas positioning before emitting a deferred cross-canvas follow', async () => {
    getCanvasViewportMock.mockReturnValue(null)

    const canvas = createCanvas([createNode('node-1', 100, 120)])
    const request: AgentCanvasFollowRequest = {
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: { type: 'node', nodeId: 'node-1' },
    }
    const setViewport = vi.fn()
    const followNodeInView = vi.fn(() => ({ found: true }))
    const setSelectedNodeIds = vi.fn()
    const onFitCanvasRequestHandled = vi.fn()
    const onNodeFollowed = vi.fn()
    const getNode = vi.fn((nodeId: string) => {
      if (nodeId === 'node-1') {
        return {
          position: { x: 100, y: 120 },
          measured: { width: 320, height: 180 },
        }
      }

      return null
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <FitThenFollowProbe
          canvas={canvas}
          request={request}
          initialFitRequestKey="canvas-1:follow"
          getNode={getNode}
          setViewport={setViewport}
          followNodeInView={followNodeInView}
          setSelectedNodeIds={setSelectedNodeIds}
          onFitCanvasRequestHandled={onFitCanvasRequestHandled}
          onNodeFollowed={onNodeFollowed}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(86)
      await Promise.resolve()
    })

    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(onFitCanvasRequestHandled).not.toHaveBeenCalled()
    expect(followNodeInView).not.toHaveBeenCalled()
    expect(setSelectedNodeIds).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(31)
      await Promise.resolve()
    })

    expect(onFitCanvasRequestHandled).not.toHaveBeenCalled()
    expect(followNodeInView).not.toHaveBeenCalled()
    expect(setSelectedNodeIds).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(17)
      await Promise.resolve()
    })

    expect(onFitCanvasRequestHandled).toHaveBeenCalledWith('canvas-1:follow')
    expect(followNodeInView).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    expect(followNodeInView).toHaveBeenCalledWith('node-1')
    expect(setSelectedNodeIds).toHaveBeenCalledWith(['node-1'])
    expect(onNodeFollowed).toHaveBeenCalledTimes(1)
    expect(setViewport.mock.invocationCallOrder[0]).toBeLessThan(followNodeInView.mock.invocationCallOrder[0])
  })

  it('emits a deferred cross-canvas follow when a saved viewport makes fit handling immediate', async () => {
    getCanvasViewportMock.mockReturnValue({ x: 10, y: 20, zoom: 0.7 })

    const canvas = createCanvas([createNode('node-1', 100, 120)])
    const request: AgentCanvasFollowRequest = {
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: { type: 'node', nodeId: 'node-1' },
    }
    const setViewport = vi.fn()
    const followNodeInView = vi.fn(() => ({ found: true }))
    const onFitCanvasRequestHandled = vi.fn()
    const getNode = vi.fn(() => null)

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <FitThenFollowProbe
          canvas={canvas}
          request={request}
          initialFitRequestKey="canvas-1:saved"
          getNode={getNode}
          setViewport={setViewport}
          followNodeInView={followNodeInView}
          onFitCanvasRequestHandled={onFitCanvasRequestHandled}
        />
      )
      await Promise.resolve()
    })

    expect(onFitCanvasRequestHandled).toHaveBeenCalledWith('canvas-1:saved')
    expect(setViewport).not.toHaveBeenCalled()
    expect(followNodeInView).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    expect(followNodeInView).toHaveBeenCalledWith('node-1')
  })

  it('fits the canvas instead of the restored selected node on first folder open', async () => {
    getCanvasViewportMock.mockReturnValue(null)

    const canvas = createCanvas([createNode('node-1', 100, 120), createNode('node-2', 760, 420)])
    const setViewport = vi.fn()
    const fitNodeInView = vi.fn()
    const onFitCanvasRequestHandled = vi.fn()
    const getNode = vi.fn((nodeId: string) => {
      if (nodeId === 'node-1') {
        return {
          position: { x: 100, y: 120 },
          measured: { width: 320, height: 180 },
        }
      }

      if (nodeId === 'node-2') {
        return {
          position: { x: 760, y: 420 },
          measured: { width: 280, height: 220 },
        }
      }

      return null
    })

    const expectedViewport = calculateCanvasFitViewport(
      [
        { x: 100, y: 120, width: 320, height: 180 },
        { x: 760, y: 420, width: 280, height: 220 },
      ],
      {
        availableWidth: 900,
        availableHeight: 900,
        centerX: 450,
        centerY: 450,
      },
      {
        padding: CANVAS.FIRST_OPEN_FIT_COMPACT_PADDING,
      }
    )

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <FolderOpenFitProbe
          canvas={canvas}
          selectedNodeId="node-1"
          fitCanvasRequestKey="canvas-1:1"
          getNode={getNode}
          setViewport={setViewport}
          fitNodeInView={fitNodeInView}
          onFitCanvasRequestHandled={onFitCanvasRequestHandled}
        />
      )
    })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(fitNodeInView).not.toHaveBeenCalled()
    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(setViewport).toHaveBeenCalledWith(expectedViewport, { duration: 0 })
    expect(onFitCanvasRequestHandled).toHaveBeenCalledWith('canvas-1:1')
  })

  it('keeps small first-open canvases capped at 80% with roomy padding', async () => {
    getCanvasViewportMock.mockReturnValue(null)

    const canvas = createCanvas([createNode('node-1', 100, 120)])
    const setViewport = vi.fn()
    const fitNodeInView = vi.fn()
    const onFitCanvasRequestHandled = vi.fn()
    const getNode = vi.fn((nodeId: string) => {
      if (nodeId === 'node-1') {
        return {
          position: { x: 100, y: 120 },
          measured: { width: 120, height: 80 },
        }
      }

      return null
    })

    const expectedViewport = calculateCanvasFitViewport(
      [{ x: 100, y: 120, width: 120, height: 80 }],
      {
        availableWidth: 900,
        availableHeight: 900,
        centerX: 450,
        centerY: 450,
      },
      {
        maxZoom: CANVAS.FIRST_OPEN_FIT_SMALL_CONTENT_MAX_ZOOM,
      }
    )

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <FolderOpenFitProbe
          canvas={canvas}
          selectedNodeId="node-1"
          fitCanvasRequestKey="canvas-1:tiny"
          getNode={getNode}
          setViewport={setViewport}
          fitNodeInView={fitNodeInView}
          onFitCanvasRequestHandled={onFitCanvasRequestHandled}
        />
      )
    })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(fitNodeInView).not.toHaveBeenCalled()
    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(setViewport).toHaveBeenCalledWith(expectedViewport, { duration: 0 })
    expect(onFitCanvasRequestHandled).toHaveBeenCalledWith('canvas-1:tiny')
  })

  it('uses compact first-open padding without a custom zoom floor for large content', async () => {
    getCanvasViewportMock.mockReturnValue(null)

    const canvas = createCanvas([createNode('node-1', 0, 120), createNode('node-2', 2_200, 420)])
    const setViewport = vi.fn()
    const fitNodeInView = vi.fn()
    const onFitCanvasRequestHandled = vi.fn()
    const getNode = vi.fn((nodeId: string) => {
      if (nodeId === 'node-1') {
        return {
          position: { x: 0, y: 120 },
          measured: { width: 320, height: 180 },
        }
      }

      if (nodeId === 'node-2') {
        return {
          position: { x: 2_200, y: 420 },
          measured: { width: 320, height: 180 },
        }
      }

      return null
    })

    const expectedViewport = calculateCanvasFitViewport(
      [
        { x: 0, y: 120, width: 320, height: 180 },
        { x: 2_200, y: 420, width: 320, height: 180 },
      ],
      {
        availableWidth: 900,
        availableHeight: 900,
        centerX: 450,
        centerY: 450,
      },
      {
        padding: CANVAS.FIRST_OPEN_FIT_COMPACT_PADDING,
      }
    )

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <FolderOpenFitProbe
          canvas={canvas}
          selectedNodeId="node-1"
          fitCanvasRequestKey="canvas-1:large"
          getNode={getNode}
          setViewport={setViewport}
          fitNodeInView={fitNodeInView}
          onFitCanvasRequestHandled={onFitCanvasRequestHandled}
        />
      )
    })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(fitNodeInView).not.toHaveBeenCalled()
    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(setViewport).toHaveBeenCalledWith(expectedViewport, { duration: 0 })
    expect(onFitCanvasRequestHandled).toHaveBeenCalledWith('canvas-1:large')
  })

  it('waits to mark the first-open fit handled until after the viewport update can paint', async () => {
    getCanvasViewportMock.mockReturnValue(null)

    const canvas = createCanvas([createNode('node-1', 100, 120)])
    let resolveViewportCommit: () => void = () => undefined
    const viewportCommit = new Promise<void>((resolve) => {
      resolveViewportCommit = resolve
    })
    const setViewport = vi.fn(() => viewportCommit)
    const fitNodeInView = vi.fn()
    const onFitCanvasRequestHandled = vi.fn()
    const getNode = vi.fn((nodeId: string) => {
      if (nodeId === 'node-1') {
        return {
          position: { x: 100, y: 120 },
          measured: { width: 320, height: 180 },
        }
      }

      return null
    })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <FolderOpenFitProbe
          canvas={canvas}
          selectedNodeId="node-1"
          fitCanvasRequestKey="canvas-1:paint"
          getNode={getNode}
          setViewport={setViewport}
          fitNodeInView={fitNodeInView}
          onFitCanvasRequestHandled={onFitCanvasRequestHandled}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(86)
      await Promise.resolve()
    })

    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(onFitCanvasRequestHandled).not.toHaveBeenCalled()

    await act(async () => {
      resolveViewportCommit()
      await Promise.resolve()
    })

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    expect(onFitCanvasRequestHandled).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(16)
      await Promise.resolve()
    })

    expect(onFitCanvasRequestHandled).toHaveBeenCalledWith('canvas-1:paint')
  })

  it('includes rendered section and group backgrounds in the first-open fit bounds', async () => {
    getCanvasViewportMock.mockReturnValue(null)

    const canvas = createCanvas([createNode('node-1', 100, 120), createNode('node-2', 760, 420)])
    const setViewport = vi.fn()
    const fitNodeInView = vi.fn()
    const onFitCanvasRequestHandled = vi.fn()
    const getNode = vi.fn((nodeId: string) => {
      if (nodeId === 'node-1') {
        return {
          position: { x: 100, y: 120 },
          measured: { width: 320, height: 180 },
        }
      }

      if (nodeId === 'node-2') {
        return {
          position: { x: 760, y: 420 },
          measured: { width: 280, height: 220 },
        }
      }

      if (nodeId === 'section-1') {
        return {
          position: { x: 50, y: 40 },
          style: { width: 1400, height: 600 },
        }
      }

      return null
    })

    const expectedViewport = calculateCanvasFitViewport(
      [
        { x: 100, y: 120, width: 320, height: 180 },
        { x: 760, y: 420, width: 280, height: 220 },
        { x: 50, y: 40, width: 1400, height: 600 },
      ],
      {
        availableWidth: 900,
        availableHeight: 900,
        centerX: 450,
        centerY: 450,
      },
      {
        padding: CANVAS.FIRST_OPEN_FIT_COMPACT_PADDING,
      }
    )

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <FolderOpenFitProbe
          canvas={canvas}
          selectedNodeId="node-1"
          fitCanvasRequestKey="canvas-1:section"
          renderedNodeIds={['node-1', 'node-2', 'section-1']}
          getNode={getNode}
          setViewport={setViewport}
          fitNodeInView={fitNodeInView}
          onFitCanvasRequestHandled={onFitCanvasRequestHandled}
        />
      )
    })

    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(fitNodeInView).not.toHaveBeenCalled()
    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(setViewport).toHaveBeenCalledWith(expectedViewport, { duration: 0 })
    expect(onFitCanvasRequestHandled).toHaveBeenCalledWith('canvas-1:section')
  })

  it('waits 70ms before calculating the first-open canvas view', async () => {
    getCanvasViewportMock.mockReturnValue(null)

    const canvas = createCanvas([createNode('node-1', 100, 120), createNode('node-2', 760, 420)])
    const setViewport = vi.fn()
    const fitNodeInView = vi.fn()
    const onFitCanvasRequestHandled = vi.fn()
    let useFinalMeasurements = false

    window.setTimeout(() => {
      useFinalMeasurements = true
    }, 48)

    const getNode = vi.fn((nodeId: string) => {
      if (nodeId === 'node-1') {
        return {
          position: { x: 100, y: 120 },
          measured: {
            width: 320,
            height: useFinalMeasurements ? 360 : 180,
          },
        }
      }

      if (nodeId === 'node-2') {
        return {
          position: { x: 760, y: 420 },
          measured: {
            width: 280,
            height: useFinalMeasurements ? 300 : 220,
          },
        }
      }

      return null
    })

    const expectedViewport = calculateCanvasFitViewport(
      [
        { x: 100, y: 120, width: 320, height: 360 },
        { x: 760, y: 420, width: 280, height: 300 },
      ],
      {
        availableWidth: 900,
        availableHeight: 900,
        centerX: 450,
        centerY: 450,
      },
      {
        padding: CANVAS.FIRST_OPEN_FIT_COMPACT_PADDING,
      }
    )

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(
        <FolderOpenFitProbe
          canvas={canvas}
          selectedNodeId="node-1"
          fitCanvasRequestKey="canvas-1:2"
          getNode={getNode}
          setViewport={setViewport}
          fitNodeInView={fitNodeInView}
          onFitCanvasRequestHandled={onFitCanvasRequestHandled}
        />
      )
    })

    await act(async () => {
      vi.advanceTimersByTime(69)
      await Promise.resolve()
    })

    expect(setViewport).not.toHaveBeenCalled()
    expect(onFitCanvasRequestHandled).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(17)
      await Promise.resolve()
    })

    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(setViewport).toHaveBeenCalledWith(expectedViewport, { duration: 0 })
    expect(onFitCanvasRequestHandled).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(32)
      await Promise.resolve()
    })

    expect(onFitCanvasRequestHandled).toHaveBeenCalledWith('canvas-1:2')
    expect(fitNodeInView).not.toHaveBeenCalled()
  })
})
