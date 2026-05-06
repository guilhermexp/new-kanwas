import { beforeEach, describe, expect, it } from 'vitest'
import type { CanvasItem, WorkspaceDocument } from 'shared'
import { getCanvasViewport } from '@/hooks/workspaceStorage'
import { ensureDedicatedProjectCanvas, ensureOnboardingDemoCanvas } from '@/lib/onboardingDemoCanvas'

function createCanvas(id: string, name: string, items: CanvasItem[] = []): CanvasItem {
  return {
    id,
    name,
    kind: 'canvas',
    xynode: {
      id,
      type: 'canvas',
      position: { x: 0, y: 0 },
      data: {},
    },
    edges: [],
    items,
  }
}

function createWorkspace(items: CanvasItem[] = []): WorkspaceDocument {
  return {
    root: createCanvas('root', '', items),
  }
}

function createIdFactory(ids: string[]) {
  let index = 0
  return () => {
    const id = ids[index]
    index += 1
    if (!id) {
      throw new Error('No test id configured')
    }
    return id
  }
}

describe('ensureOnboardingDemoCanvas', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    })
  })

  it('creates Projects/onboarding-demo and stores the origin-offset viewport', () => {
    const store = createWorkspace()

    const result = ensureOnboardingDemoCanvas({
      workspaceId: 'workspace-create-projects',
      store,
      userId: 'user-1',
      visibleArea: { availableWidth: 1000, availableHeight: 600 },
      idFactory: createIdFactory(['projects-id', 'demo-id']),
      now: () => new Date('2026-05-05T10:00:00.000Z'),
    })

    expect(result.canvasId).toBe('demo-id')
    expect(result.viewport).toEqual({ x: 220, y: 102, zoom: 1 })
    expect(store.root.items).toHaveLength(1)

    const projects = store.root.items[0]
    if (projects.kind !== 'canvas') {
      throw new Error('Expected Projects to be a canvas')
    }
    expect(projects.name).toBe('Projects')
    expect(projects.items).toHaveLength(1)
    expect(projects.items[0]).toMatchObject({
      id: 'demo-id',
      kind: 'canvas',
      name: 'onboarding-demo',
    })
    expect(getCanvasViewport('workspace-create-projects', 'demo-id')).toEqual({ x: 220, y: 102, zoom: 1 })
  })

  it('creates a dedicated project folder and stores the origin-offset viewport', () => {
    const store = createWorkspace()

    const result = ensureDedicatedProjectCanvas({
      workspaceId: 'workspace-dedicated-folder',
      store,
      folderName: 'activation-plan',
      visibleArea: { availableWidth: 900, availableHeight: 500 },
      idFactory: createIdFactory(['projects-id', 'activation-id']),
    })

    expect(result.canvasId).toBe('activation-id')
    expect(result.folderName).toBe('activation-plan')
    expect(result.viewport).toEqual({ x: 198, y: 85, zoom: 1 })

    const projects = store.root.items[0]
    if (projects.kind !== 'canvas') {
      throw new Error('Expected Projects to be a canvas')
    }

    expect(projects.name).toBe('Projects')
    expect(projects.items[0]).toMatchObject({
      id: 'activation-id',
      kind: 'canvas',
      name: 'activation-plan',
    })
    expect(getCanvasViewport('workspace-dedicated-folder', 'activation-id')).toEqual({ x: 198, y: 85, zoom: 1 })
  })

  it('reuses a case-insensitive Projects folder and creates a unique demo sibling', () => {
    const existingProjects = createCanvas('projects-id', 'projects', [
      createCanvas('existing-demo-id', 'onboarding-demo'),
    ])
    const store = createWorkspace([existingProjects])

    const result = ensureOnboardingDemoCanvas({
      workspaceId: 'workspace-unique-demo',
      store,
      visibleArea: { availableWidth: 1200, availableHeight: 800 },
      idFactory: createIdFactory(['demo-2-id']),
    })

    expect(result.canvasId).toBe('demo-2-id')
    expect(store.root.items).toHaveLength(1)
    expect(existingProjects.items.map((item) => item.name)).toEqual(['onboarding-demo', 'onboarding-demo 2'])
    expect(getCanvasViewport('workspace-unique-demo', 'demo-2-id')).toEqual({ x: 264, y: 136, zoom: 1 })
  })

  it('creates a unique dedicated project sibling when the folder already exists', () => {
    const existingProjects = createCanvas('projects-id', 'projects', [
      createCanvas('existing-activation-id', 'activation-plan'),
    ])
    const store = createWorkspace([existingProjects])

    const result = ensureDedicatedProjectCanvas({
      workspaceId: 'workspace-unique-dedicated-folder',
      store,
      folderName: 'activation-plan',
      visibleArea: { availableWidth: 1200, availableHeight: 800 },
      idFactory: createIdFactory(['activation-2-id']),
    })

    expect(result.canvasId).toBe('activation-2-id')
    expect(result.folderName).toBe('activation-plan 2')
    expect(existingProjects.items.map((item) => item.name)).toEqual(['activation-plan', 'activation-plan 2'])
    expect(getCanvasViewport('workspace-unique-dedicated-folder', 'activation-2-id')).toEqual({
      x: 264,
      y: 136,
      zoom: 1,
    })
  })
})
