import type { CanvasItem, WorkspaceDocument } from 'shared'
import { calculateItemPosition, CANVAS_NODE_LAYOUT, sanitizeFilename } from 'shared/constants'
import { appendCanvasWithCreateAudit, createUserAuditActor } from '@/lib/workspaceAudit'
import { getUniqueSiblingName } from '@/lib/workspaceItemNames'
import { setCanvasViewport } from '@/hooks/workspaceStorage'

const PROJECTS_CANVAS_NAME = 'Projects'
const ONBOARDING_DEMO_CANVAS_NAME = 'onboarding-demo'
const DEDICATED_PROJECT_VIEWPORT_ZOOM = 1
const DEDICATED_PROJECT_ORIGIN_X_RATIO = 0.22
const DEDICATED_PROJECT_ORIGIN_Y_RATIO = 0.17

interface EnsureDedicatedProjectCanvasOptions {
  workspaceId: string
  store: WorkspaceDocument
  folderName: string
  userId?: string | null
  visibleArea: { availableWidth: number; availableHeight: number }
  idFactory?: () => string
  now?: () => Date
}

type EnsureOnboardingDemoCanvasOptions = Omit<EnsureDedicatedProjectCanvasOptions, 'folderName'>

export interface EnsureDedicatedProjectCanvasResult {
  canvasId: string
  folderName: string
  viewport: { x: number; y: number; zoom: number }
}

export type EnsureOnboardingDemoCanvasResult = EnsureDedicatedProjectCanvasResult

function isProjectsCanvas(item: CanvasItem): boolean {
  return item.name.trim().toLowerCase() === PROJECTS_CANVAS_NAME.toLowerCase()
}

function createCanvasItem(id: string, name: string, parentCanvas: CanvasItem): CanvasItem {
  return {
    id,
    name,
    kind: 'canvas',
    xynode: {
      id,
      type: 'canvas',
      position: calculateItemPosition(parentCanvas.items, {
        direction: 'vertical',
        defaultSize: CANVAS_NODE_LAYOUT.HEIGHT,
      }),
      data: {},
    },
    edges: [],
    items: [],
  }
}

export function ensureDedicatedProjectCanvas({
  workspaceId,
  store,
  folderName,
  userId,
  visibleArea,
  idFactory = () => crypto.randomUUID(),
  now = () => new Date(),
}: EnsureDedicatedProjectCanvasOptions): EnsureDedicatedProjectCanvasResult {
  const root = store.root
  if (!root) {
    throw new Error('Workspace root is not available')
  }

  const auditActor = createUserAuditActor(userId)
  const nowIso = now().toISOString()

  let projectsCanvas = root.items.find((item): item is CanvasItem => item.kind === 'canvas' && isProjectsCanvas(item))
  if (!projectsCanvas) {
    projectsCanvas = createCanvasItem(
      idFactory(),
      getUniqueSiblingName({
        siblings: root.items,
        preferredName: PROJECTS_CANVAS_NAME,
        target: { kind: 'canvas' },
      }),
      root
    )
    appendCanvasWithCreateAudit(root, projectsCanvas, auditActor, nowIso)
  }

  const sanitizedFolderName = sanitizeFilename(folderName)
  const dedicatedProjectCanvas = createCanvasItem(
    idFactory(),
    getUniqueSiblingName({
      siblings: projectsCanvas.items,
      preferredName: sanitizedFolderName,
      target: { kind: 'canvas' },
    }),
    projectsCanvas
  )
  appendCanvasWithCreateAudit(projectsCanvas, dedicatedProjectCanvas, auditActor, nowIso)

  const viewport = {
    x: Math.round(visibleArea.availableWidth * DEDICATED_PROJECT_ORIGIN_X_RATIO),
    y: Math.round(visibleArea.availableHeight * DEDICATED_PROJECT_ORIGIN_Y_RATIO),
    zoom: DEDICATED_PROJECT_VIEWPORT_ZOOM,
  }
  setCanvasViewport(workspaceId, dedicatedProjectCanvas.id, viewport)

  return {
    canvasId: dedicatedProjectCanvas.id,
    folderName: dedicatedProjectCanvas.name,
    viewport,
  }
}

export function ensureOnboardingDemoCanvas(
  options: EnsureOnboardingDemoCanvasOptions
): EnsureOnboardingDemoCanvasResult {
  return ensureDedicatedProjectCanvas({
    ...options,
    folderName: ONBOARDING_DEMO_CANVAS_NAME,
  })
}
