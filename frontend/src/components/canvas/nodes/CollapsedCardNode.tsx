import { memo } from 'react'
import {
  CheckSquare,
  Columns3,
  File,
  FileText,
  Folder,
  Github,
  Image,
  Link,
  Palette,
  PenLine,
  StickyNote,
  Terminal,
  UserRound,
  Video,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { COLLAPSED_NODE_LAYOUT, NODE_NAME_HEIGHT } from 'shared/constants'
import type { CommonNodeData } from '../types'
import { DocumentName } from './DocumentName'

type CollapsedCardData = CommonNodeData & {
  emoji?: string
  summary?: string
  originalType?: string
}

interface CollapsedCardNodeProps {
  id: string
  selected?: boolean
  data: CollapsedCardData
}

function SkeletonBar({ width, height = 10 }: { width: string; height?: number }) {
  return <div className="rounded-full animate-skeleton" style={{ width, height: `${height}px` }} />
}

type CollapsedIconKind =
  | 'audio'
  | 'canvas'
  | 'checklist'
  | 'contact'
  | 'document'
  | 'file'
  | 'image'
  | 'kanban'
  | 'link'
  | 'palette'
  | 'repository'
  | 'shell'
  | 'sketch'
  | 'sticky'
  | 'text'
  | 'video'

const collapsedCardIcons = {
  audio: Volume2,
  canvas: Folder,
  checklist: CheckSquare,
  contact: UserRound,
  document: FileText,
  file: File,
  image: Image,
  kanban: Columns3,
  link: Link,
  palette: Palette,
  repository: Github,
  shell: Terminal,
  sketch: PenLine,
  sticky: StickyNote,
  text: FileText,
  video: Video,
} satisfies Record<CollapsedIconKind, LucideIcon>

function getCollapsedIconKind(originalType?: string): CollapsedIconKind {
  switch (originalType) {
    case 'audio':
      return 'audio'
    case 'canvas':
      return 'canvas'
    case 'checklist':
      return 'checklist'
    case 'contact':
      return 'contact'
    case 'file':
      return 'file'
    case 'image':
      return 'image'
    case 'kanban':
      return 'kanban'
    case 'link':
      return 'link'
    case 'palette':
      return 'palette'
    case 'repository':
    case 'repo':
    case 'git':
      return 'repository'
    case 'shell':
      return 'shell'
    case 'sketch':
      return 'sketch'
    case 'stickyNote':
    case 'sticky':
      return 'sticky'
    case 'text':
      return 'text'
    case 'video':
      return 'video'
    case 'blockNote':
    default:
      return 'document'
  }
}

export default memo(function CollapsedCardNode({ id, selected, data }: CollapsedCardNodeProps) {
  const { documentName, summary, originalType, onExpandNode } = data
  const isLoading = summary == null
  const cardHeight = COLLAPSED_NODE_LAYOUT.HEIGHT - NODE_NAME_HEIGHT
  const Icon = collapsedCardIcons[getCollapsedIconKind(originalType)]

  return (
    <div
      className="group/collapsed"
      style={{ width: `${COLLAPSED_NODE_LAYOUT.WIDTH}px`, height: `${COLLAPSED_NODE_LAYOUT.HEIGHT}px` }}
    >
      <DocumentName
        nodeId={id}
        documentName={documentName || 'Untitled'}
        isStatic
        onToggleCollapse={() => onExpandNode?.(id)}
        collapsed
        containerStyle={{ width: COLLAPSED_NODE_LAYOUT.WIDTH, maxWidth: COLLAPSED_NODE_LAYOUT.WIDTH }}
      />
      <div
        className={`bg-white dark:bg-editor border node-card-blocknote node-card-collapsed box-border relative cursor-pointer ${
          selected ? 'node-card-selected' : ''
        }`}
        style={{
          width: `${COLLAPSED_NODE_LAYOUT.WIDTH}px`,
          height: `${cardHeight}px`,
          borderRadius: '20px',
          overflow: 'hidden',
        }}
        onDoubleClick={() => onExpandNode?.(id)}
      >
        <div className="flex flex-row items-center h-full gap-3" style={{ padding: '16px 18px' }}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-outline bg-canvas/70 text-foreground-muted">
            <Icon aria-hidden="true" size={22} strokeWidth={1.8} />
          </div>
          <div className="flex flex-col min-w-0 flex-1" style={{ gap: '2px' }}>
            {isLoading ? (
              <div className="flex flex-col" style={{ gap: '8px' }}>
                <SkeletonBar width="70%" height={14} />
                <div className="flex flex-col" style={{ gap: '2px' }}>
                  <SkeletonBar width="90%" height={10} />
                  <SkeletonBar width="55%" height={10} />
                </div>
              </div>
            ) : (
              <>
                <div className="font-bold truncate text-foreground" style={{ fontSize: '18px', lineHeight: '24px' }}>
                  {documentName || 'Untitled'}
                </div>
                {summary && (
                  <div
                    className="text-foreground-muted line-clamp-2 font-medium"
                    style={{ fontSize: '14px', lineHeight: '18px' }}
                  >
                    {summary}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
