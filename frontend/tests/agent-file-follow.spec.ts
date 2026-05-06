import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CanvasItem, NodeItem } from 'shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectLiveAgentCanvasFollowTargets,
  createAgentCanvasFollowRequest,
  createAgentFileFollowBatchTarget,
  evaluateAgentFileFollow,
  type AgentCanvasFollowRequest,
  getAgentFileFollowPath,
  type AgentFileFollowBatchTarget,
  type AgentFileFollowCandidate,
  type AgentFileFollowTarget,
} from '@/components/chat/agentFileFollow'
import {
  AGENT_FOLLOW_DEBOUNCE_MS,
  AGENT_FOLLOW_MAX_DELAY_MS,
  useAgentCanvasFollow,
} from '@/components/chat/useAgentCanvasFollow'
import type { AgentInvocationUiOptions } from '@/providers/chat/invocationOptions'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function textEditorItem(overrides: Partial<AgentFileFollowCandidate>): AgentFileFollowCandidate {
  return {
    id: 'tool-1',
    type: 'text_editor',
    command: 'create',
    path: '/workspace/canvas/doc.md',
    status: 'executing',
    ...overrides,
  }
}

function createCanvasNode(id: string, name: string): NodeItem {
  return {
    kind: 'node',
    id,
    name,
    xynode: {
      id,
      type: 'blockNote',
      position: { x: 0, y: 0 },
      data: {},
    },
  }
}

function createWorkspaceRoot(options: {
  nodes: Array<{ id: string; name: string }>
  sections?: Array<{ id: string; memberIds: string[] }>
}): CanvasItem {
  const canvas: CanvasItem = {
    kind: 'canvas',
    id: 'canvas-1',
    name: 'canvas',
    xynode: {
      id: 'canvas-1',
      type: 'canvas',
      position: { x: 0, y: 0 },
      data: {},
    },
    edges: [],
    items: options.nodes.map((node) => createCanvasNode(node.id, node.name)),
    sections: options.sections,
  }

  return {
    kind: 'canvas',
    id: 'root',
    name: 'root',
    xynode: {
      id: 'root',
      type: 'canvas',
      position: { x: 0, y: 0 },
      data: {},
    },
    edges: [],
    items: [canvas],
  }
}

function decide(options: {
  item?: AgentFileFollowCandidate
  enabled?: boolean
  resolved?: AgentFileFollowTarget | null
  activeCanvasId?: string | null
  handledItemIds?: string[]
}) {
  return evaluateAgentFileFollow({
    enabled: options.enabled ?? true,
    item: options.item ?? textEditorItem({}),
    resolved:
      'resolved' in options && options.resolved !== undefined
        ? options.resolved
        : { nodeId: 'node-1', canvasId: 'canvas-1' },
    activeCanvasId: options.activeCanvasId ?? 'canvas-1',
    handledItemIds: new Set(options.handledItemIds ?? []),
  })
}

describe('agent file follow decisions', () => {
  it('uses animationKey before path for follow resolution', () => {
    expect(
      getAgentFileFollowPath({
        path: '/workspace/canvas/doc.md',
        animationKey: '/workspace/canvas/renamed-doc.md',
      })
    ).toBe('/workspace/canvas/renamed-doc.md')
  })

  it('follows write_file in the active canvas', () => {
    expect(decide({ item: textEditorItem({ command: 'create' }) })).toMatchObject({
      type: 'follow',
      operation: 'write',
      nodeId: 'node-1',
      canvasId: 'canvas-1',
      switchCanvas: false,
      shouldMarkHandled: true,
    })
  })

  it('follows edit_file in the active canvas', () => {
    expect(decide({ item: textEditorItem({ command: 'insert' }) })).toMatchObject({
      type: 'follow',
      operation: 'edit',
      switchCanvas: false,
    })
  })

  it('uses streaming toolName while edit_file command details are still resolving', () => {
    expect(decide({ item: textEditorItem({ command: 'view', toolName: 'edit_file' }) })).toMatchObject({
      type: 'follow',
      operation: 'edit',
      switchCanvas: false,
    })
  })

  it('switches canvas for write_file outside the active canvas', () => {
    expect(
      decide({
        item: textEditorItem({ command: 'create' }),
        resolved: { nodeId: 'node-2', canvasId: 'canvas-2' },
      })
    ).toMatchObject({
      type: 'follow',
      operation: 'write',
      nodeId: 'node-2',
      canvasId: 'canvas-2',
      switchCanvas: true,
    })
  })

  it('marks edit_file outside the active canvas as handled without following', () => {
    expect(
      decide({
        item: textEditorItem({ command: 'str_replace' }),
        resolved: { nodeId: 'node-2', canvasId: 'canvas-2' },
      })
    ).toEqual({
      type: 'none',
      shouldMarkHandled: true,
    })
  })

  it('ignores everything while disabled', () => {
    expect(decide({ enabled: false })).toEqual({
      type: 'none',
      shouldMarkHandled: false,
    })
  })

  it('ignores handled items', () => {
    expect(decide({ handledItemIds: ['tool-1'] })).toEqual({
      type: 'none',
      shouldMarkHandled: false,
    })
  })

  it('ignores reads, deletes, and failed items as handled', () => {
    expect(decide({ item: textEditorItem({ command: 'view' }) })).toEqual({
      type: 'none',
      shouldMarkHandled: true,
    })
    expect(decide({ item: textEditorItem({ command: 'delete' }) })).toEqual({
      type: 'none',
      shouldMarkHandled: true,
    })
    expect(decide({ item: textEditorItem({ status: 'failed' }) })).toEqual({
      type: 'none',
      shouldMarkHandled: true,
    })
  })

  it('leaves unresolved write/edit items unhandled so they can resolve later', () => {
    expect(decide({ resolved: null })).toEqual({
      type: 'none',
      shouldMarkHandled: false,
    })
  })

  it('does not freeze section membership into queued follow targets', () => {
    const decision = decide({
      resolved: { nodeId: 'node-1', canvasId: 'canvas-1', sectionId: 'section-1' },
    })

    expect(decision.type).toBe('follow')
    if (decision.type === 'follow') {
      expect(createAgentFileFollowBatchTarget(decision)).toEqual({
        itemId: 'tool-1',
        operation: 'write',
        nodeId: 'node-1',
        canvasId: 'canvas-1',
      })
    }
  })
})

describe('live agent file follow requests', () => {
  function live(options: {
    items: AgentFileFollowCandidate[]
    resolvedByPath?: Record<string, AgentFileFollowTarget | null>
    handledItemIds?: string[]
    pendingResolutionItemIds?: string[]
    activeCanvasId?: string | null
    enabled?: boolean
  }) {
    return collectLiveAgentCanvasFollowTargets({
      enabled: options.enabled ?? true,
      items: options.items,
      activeCanvasId: options.activeCanvasId ?? 'canvas-1',
      handledItemIds: new Set(options.handledItemIds ?? []),
      pendingResolutionItemIds: new Set(options.pendingResolutionItemIds ?? []),
      resolveTarget: (path) => options.resolvedByPath?.[path] ?? null,
    })
  }

  it('collects a follow target for an executing write before completion', () => {
    const result = live({
      items: [textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc.md' })],
      resolvedByPath: {
        '/workspace/canvas/doc.md': { nodeId: 'node-1', canvasId: 'canvas-1' },
      },
    })

    expect(result.handledItemIds).toEqual(['tool-1'])
    expect(result.followTargets).toEqual([
      {
        itemId: 'tool-1',
        operation: 'write',
        nodeId: 'node-1',
        canvasId: 'canvas-1',
      },
    ])
  })

  it('keeps unresolved executing writes unhandled so they can resolve later', () => {
    const unresolved = live({
      items: [textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc.md' })],
      resolvedByPath: {
        '/workspace/canvas/doc.md': null,
      },
    })

    expect(unresolved.followTargets).toEqual([])
    expect(unresolved.handledItemIds).toEqual([])
    expect(unresolved.hasUnresolvedFollowCandidate).toBe(true)

    const resolved = live({
      items: [textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc.md' })],
      resolvedByPath: {
        '/workspace/canvas/doc.md': { nodeId: 'node-1', canvasId: 'canvas-1' },
      },
    })

    expect(resolved.followTargets).toEqual([
      {
        itemId: 'tool-1',
        operation: 'write',
        nodeId: 'node-1',
        canvasId: 'canvas-1',
      },
    ])
    expect(resolved.handledItemIds).toEqual(['tool-1'])
  })

  it('can follow a completed item that was unresolved while executing', () => {
    const result = live({
      items: [textEditorItem({ id: 'tool-1', command: 'create', status: 'completed' })],
      pendingResolutionItemIds: ['tool-1'],
      resolvedByPath: {
        '/workspace/canvas/doc.md': { nodeId: 'node-1', canvasId: 'canvas-1' },
      },
    })

    expect(result.followTargets).toEqual([
      {
        itemId: 'tool-1',
        operation: 'write',
        nodeId: 'node-1',
        canvasId: 'canvas-1',
      },
    ])
    expect(result.handledItemIds).toEqual(['tool-1'])
    expect(result.unresolvedItemIds).toEqual([])
  })

  it('keeps a completed pending-resolution item unhandled until it resolves', () => {
    const result = live({
      items: [textEditorItem({ id: 'tool-1', command: 'create', status: 'completed' })],
      pendingResolutionItemIds: ['tool-1'],
      resolvedByPath: {
        '/workspace/canvas/doc.md': null,
      },
    })

    expect(result.followTargets).toEqual([])
    expect(result.handledItemIds).toEqual([])
    expect(result.unresolvedItemIds).toEqual(['tool-1'])
    expect(result.hasUnresolvedFollowCandidate).toBe(true)
  })

  it('does not follow completed historical writes', () => {
    const result = live({
      items: [textEditorItem({ id: 'tool-1', command: 'create', status: 'completed' })],
      resolvedByPath: {
        '/workspace/canvas/doc.md': { nodeId: 'node-1', canvasId: 'canvas-1' },
      },
    })

    expect(result.followTargets).toEqual([])
    expect(result.handledItemIds).toEqual(['tool-1'])
  })

  it('follows edits in the active canvas but not edits outside it', () => {
    const activeEdit = live({
      items: [textEditorItem({ id: 'tool-1', command: 'insert', path: '/workspace/canvas/doc.md' })],
      resolvedByPath: {
        '/workspace/canvas/doc.md': { nodeId: 'node-1', canvasId: 'canvas-1' },
      },
    })
    expect(activeEdit.followTargets).toEqual([
      {
        itemId: 'tool-1',
        operation: 'edit',
        nodeId: 'node-1',
        canvasId: 'canvas-1',
      },
    ])

    const outsideEdit = live({
      items: [textEditorItem({ id: 'tool-2', command: 'str_replace', path: '/workspace/other/doc.md' })],
      resolvedByPath: {
        '/workspace/other/doc.md': { nodeId: 'node-2', canvasId: 'canvas-2' },
      },
      activeCanvasId: 'canvas-1',
    })
    expect(outsideEdit.followTargets).toEqual([])
    expect(outsideEdit.handledItemIds).toEqual(['tool-2'])
  })

  it('follows a shared section for same-batch live targets', () => {
    const result = live({
      items: [
        textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc-1.md' }),
        textEditorItem({ id: 'tool-2', command: 'create', path: '/workspace/canvas/doc-2.md' }),
      ],
      resolvedByPath: {
        '/workspace/canvas/doc-1.md': { nodeId: 'node-1', canvasId: 'canvas-1' },
        '/workspace/canvas/doc-2.md': { nodeId: 'node-2', canvasId: 'canvas-1' },
      },
    })
    const request = createAgentCanvasFollowRequest(result.followTargets, {
      getSectionId: () => 'section-1',
    })

    expect(request).toEqual({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-2',
      viewportTarget: {
        type: 'section',
        sectionId: 'section-1',
      },
    })
  })

  it('exposes staggered parallel write targets so Chat can coalesce them into one section follow', () => {
    const first = live({
      items: [
        textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc-1.md' }),
        textEditorItem({ id: 'tool-2', command: 'create', path: '/workspace/canvas/doc-2.md' }),
      ],
      resolvedByPath: {
        '/workspace/canvas/doc-1.md': { nodeId: 'node-1', canvasId: 'canvas-1' },
        '/workspace/canvas/doc-2.md': null,
      },
    })

    expect(first.followTargets).toEqual([
      {
        itemId: 'tool-1',
        operation: 'write',
        nodeId: 'node-1',
        canvasId: 'canvas-1',
      },
    ])
    expect(first.hasUnresolvedFollowCandidate).toBe(true)

    const second = live({
      items: [
        textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc-1.md' }),
        textEditorItem({ id: 'tool-2', command: 'create', path: '/workspace/canvas/doc-2.md' }),
      ],
      handledItemIds: first.handledItemIds,
      pendingResolutionItemIds: first.unresolvedItemIds,
      resolvedByPath: {
        '/workspace/canvas/doc-1.md': { nodeId: 'node-1', canvasId: 'canvas-1' },
        '/workspace/canvas/doc-2.md': { nodeId: 'node-2', canvasId: 'canvas-1' },
      },
    })

    const coalescedRequest = createAgentCanvasFollowRequest([...first.followTargets, ...second.followTargets], {
      getSectionId: (target) => (target.nodeId === 'node-1' || target.nodeId === 'node-2' ? 'section-1' : null),
    })

    expect(second.followTargets).toEqual([
      {
        itemId: 'tool-2',
        operation: 'write',
        nodeId: 'node-2',
        canvasId: 'canvas-1',
      },
    ])
    expect(second.hasUnresolvedFollowCandidate).toBe(false)
    expect(coalescedRequest).toEqual({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-2',
      viewportTarget: {
        type: 'section',
        sectionId: 'section-1',
      },
    })
  })
})

function AgentCanvasFollowProbe({
  workspaceId = 'workspace-1',
  activeTaskId = 'task-1',
  invocationId = 'invocation-1',
  activeInvocationOptions = { mode: 'direct', follow: true },
  items,
  root,
  activeCanvasId = 'canvas-1',
  onFollowRequest,
}: {
  workspaceId?: string
  activeTaskId?: string | null
  invocationId?: string | null
  activeInvocationOptions?: AgentInvocationUiOptions | null
  items: AgentFileFollowCandidate[]
  root: CanvasItem
  activeCanvasId?: string | null
  onFollowRequest: (request: AgentCanvasFollowRequest) => void
}) {
  useAgentCanvasFollow({
    workspaceId,
    activeTaskId,
    invocationId,
    activeInvocationOptions,
    items,
    root,
    activeCanvasId,
    onFollowRequest,
  })

  return null
}

describe('agent canvas follow hook', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }

    container?.remove()
    container = null
    root = null
    vi.useRealTimers()
  })

  function renderProbe(props: Parameters<typeof AgentCanvasFollowProbe>[0]) {
    act(() => {
      root?.render(createElement(AgentCanvasFollowProbe, props))
    })
  }

  function advanceTimers(ms: number) {
    act(() => {
      vi.advanceTimersByTime(ms)
    })
  }

  it('coalesces staggered same-section parallel writes into one section follow', () => {
    const onFollowRequest = vi.fn()
    const items = [
      textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc-1.md' }),
      textEditorItem({ id: 'tool-2', command: 'create', path: '/workspace/canvas/doc-2.md' }),
    ]

    renderProbe({
      items,
      root: createWorkspaceRoot({
        nodes: [{ id: 'node-1', name: 'doc-1' }],
        sections: [{ id: 'section-1', memberIds: ['node-1', 'node-2'] }],
      }),
      onFollowRequest,
    })

    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS)
    expect(onFollowRequest).not.toHaveBeenCalled()

    renderProbe({
      items,
      root: createWorkspaceRoot({
        nodes: [
          { id: 'node-1', name: 'doc-1' },
          { id: 'node-2', name: 'doc-2' },
        ],
        sections: [{ id: 'section-1', memberIds: ['node-1', 'node-2'] }],
      }),
      onFollowRequest,
    })

    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS - 1)
    expect(onFollowRequest).not.toHaveBeenCalled()

    advanceTimers(1)
    expect(onFollowRequest).toHaveBeenCalledTimes(1)
    expect(onFollowRequest).toHaveBeenLastCalledWith({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-2',
      viewportTarget: {
        type: 'section',
        sectionId: 'section-1',
      },
    })
  })

  it('flushes the latest resolved target when a parallel sibling stays unresolved', () => {
    const onFollowRequest = vi.fn()

    renderProbe({
      items: [
        textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc-1.md' }),
        textEditorItem({ id: 'tool-2', command: 'create', path: '/workspace/canvas/doc-2.md' }),
      ],
      root: createWorkspaceRoot({
        nodes: [{ id: 'node-1', name: 'doc-1' }],
      }),
      onFollowRequest,
    })

    advanceTimers(AGENT_FOLLOW_MAX_DELAY_MS - 1)
    expect(onFollowRequest).not.toHaveBeenCalled()

    advanceTimers(1)
    expect(onFollowRequest).toHaveBeenCalledTimes(1)
    expect(onFollowRequest).toHaveBeenLastCalledWith({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: {
        type: 'node',
        nodeId: 'node-1',
      },
    })
  })

  it('does not emit duplicate same-target requests after streaming updates', () => {
    const onFollowRequest = vi.fn()
    const workspaceRoot = createWorkspaceRoot({
      nodes: [{ id: 'node-1', name: 'doc' }],
    })

    renderProbe({
      items: [textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc.md' })],
      root: workspaceRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS)

    renderProbe({
      items: [textEditorItem({ id: 'tool-2', command: 'insert', path: '/workspace/canvas/doc.md' })],
      root: workspaceRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS)

    expect(onFollowRequest).toHaveBeenCalledTimes(1)
  })

  it('allows target A, then B, then A again as distinct transitions', () => {
    const onFollowRequest = vi.fn()
    const workspaceRoot = createWorkspaceRoot({
      nodes: [
        { id: 'node-a', name: 'a' },
        { id: 'node-b', name: 'b' },
      ],
    })

    renderProbe({
      items: [textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/a.md' })],
      root: workspaceRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS)

    renderProbe({
      items: [textEditorItem({ id: 'tool-2', command: 'create', path: '/workspace/canvas/b.md' })],
      root: workspaceRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS)

    renderProbe({
      items: [textEditorItem({ id: 'tool-3', command: 'insert', path: '/workspace/canvas/a.md' })],
      root: workspaceRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS)

    expect(onFollowRequest).toHaveBeenCalledTimes(3)
    expect(onFollowRequest.mock.calls.map(([request]) => request.selectedNodeId)).toEqual([
      'node-a',
      'node-b',
      'node-a',
    ])
  })

  it('only follows when active invocation options enable follow', () => {
    const onFollowRequest = vi.fn()
    const workspaceRoot = createWorkspaceRoot({
      nodes: [{ id: 'node-1', name: 'doc' }],
    })
    const items = [textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc.md' })]

    renderProbe({
      activeInvocationOptions: null,
      items,
      root: workspaceRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS)

    renderProbe({
      activeInvocationOptions: { mode: 'direct', follow: false },
      items,
      root: workspaceRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS)

    renderProbe({
      activeInvocationOptions: { mode: 'direct', follow: true },
      items,
      root: workspaceRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_DEBOUNCE_MS)

    expect(onFollowRequest).toHaveBeenCalledTimes(1)
    expect(onFollowRequest).toHaveBeenLastCalledWith({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-1',
      viewportTarget: {
        type: 'node',
        nodeId: 'node-1',
      },
    })
  })

  it('clears pending follow batches when disabled, scope changes, or unmounts', () => {
    const onFollowRequest = vi.fn()
    const items = [
      textEditorItem({ id: 'tool-1', command: 'create', path: '/workspace/canvas/doc-1.md' }),
      textEditorItem({ id: 'tool-2', command: 'create', path: '/workspace/canvas/doc-2.md' }),
    ]
    const partialRoot = createWorkspaceRoot({
      nodes: [{ id: 'node-1', name: 'doc-1' }],
    })

    renderProbe({
      items,
      root: partialRoot,
      onFollowRequest,
    })
    renderProbe({
      activeInvocationOptions: { mode: 'direct', follow: false },
      items,
      root: partialRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_MAX_DELAY_MS)
    expect(onFollowRequest).not.toHaveBeenCalled()

    renderProbe({
      items,
      root: partialRoot,
      onFollowRequest,
    })
    renderProbe({
      activeTaskId: 'task-2',
      items: [],
      root: partialRoot,
      onFollowRequest,
    })
    advanceTimers(AGENT_FOLLOW_MAX_DELAY_MS)
    expect(onFollowRequest).not.toHaveBeenCalled()

    renderProbe({
      activeTaskId: 'task-3',
      items,
      root: partialRoot,
      onFollowRequest,
    })
    act(() => {
      root?.unmount()
      root = null
    })
    advanceTimers(AGENT_FOLLOW_MAX_DELAY_MS)
    expect(onFollowRequest).not.toHaveBeenCalled()
  })
})

describe('agent file follow batching', () => {
  function target(overrides: Partial<AgentFileFollowBatchTarget>): AgentFileFollowBatchTarget {
    return {
      itemId: 'tool-1',
      operation: 'write',
      nodeId: 'node-1',
      canvasId: 'canvas-1',
      sectionId: 'section-1',
      ...overrides,
    }
  }

  it('follows a shared section for parallel writes in one section', () => {
    expect(
      createAgentCanvasFollowRequest([
        target({ itemId: 'tool-1', nodeId: 'node-1' }),
        target({ itemId: 'tool-2', nodeId: 'node-2' }),
      ])
    ).toEqual({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-2',
      viewportTarget: {
        type: 'section',
        sectionId: 'section-1',
      },
    })
  })

  it('follows the latest file for parallel writes across sections', () => {
    expect(
      createAgentCanvasFollowRequest([
        target({ itemId: 'tool-1', nodeId: 'node-1', sectionId: 'section-1' }),
        target({ itemId: 'tool-2', nodeId: 'node-2', sectionId: 'section-2' }),
      ])
    ).toEqual({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-2',
      viewportTarget: {
        type: 'node',
        nodeId: 'node-2',
      },
    })
  })

  it('follows a shared section for mixed write and edit targets in one section', () => {
    expect(
      createAgentCanvasFollowRequest([
        target({ itemId: 'tool-1', nodeId: 'node-1', operation: 'write' }),
        target({ itemId: 'tool-2', nodeId: 'node-2', operation: 'edit' }),
      ])
    ).toEqual({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-2',
      viewportTarget: {
        type: 'section',
        sectionId: 'section-1',
      },
    })
  })

  it('uses section membership resolved at request creation time', () => {
    expect(
      createAgentCanvasFollowRequest(
        [
          target({ itemId: 'tool-1', nodeId: 'node-1', sectionId: null }),
          target({ itemId: 'tool-2', nodeId: 'node-2', sectionId: null }),
        ],
        {
          getSectionId: () => 'section-2',
        }
      )
    ).toEqual({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-2',
      viewportTarget: {
        type: 'section',
        sectionId: 'section-2',
      },
    })
  })

  it('does not use a section for edit-only batches', () => {
    expect(
      createAgentCanvasFollowRequest([
        target({ itemId: 'tool-1', nodeId: 'node-1', operation: 'edit' }),
        target({ itemId: 'tool-2', nodeId: 'node-2', operation: 'edit' }),
      ])
    ).toEqual({
      canvasId: 'canvas-1',
      selectedNodeId: 'node-2',
      viewportTarget: {
        type: 'node',
        nodeId: 'node-2',
      },
    })
  })

  it('returns null for an empty batch', () => {
    expect(createAgentCanvasFollowRequest([])).toBeNull()
  })
})
