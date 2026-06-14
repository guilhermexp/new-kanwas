import { memo, useCallback, useState } from 'react'
import { NodeResizeControl } from '@xyflow/react'
import type { VideoNode as VideoNodeType } from 'shared'
import { formatFileSize, NODE_NAME_HEIGHT, VIDEO_NODE_LAYOUT } from 'shared/constants'
import { useSignedUrl } from '@/hooks/useSignedUrl'
import type { WithCanvasData } from '../types'
import { DocumentName } from './DocumentName'
import { RESIZE_HANDLE_SIZE } from './ResizeHandle'

type VideoNodeProps = WithCanvasData<VideoNodeType>

const controlStyle: React.CSSProperties = {
  width: RESIZE_HANDLE_SIZE,
  height: RESIZE_HANDLE_SIZE,
  background: 'transparent',
  border: 'none',
  translate: '-98% -98%',
  zIndex: 10,
  cursor: 'se-resize',
  userSelect: 'none',
  WebkitUserSelect: 'none',
}

function getExtensionFromFilename(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1 || lastDot === 0) return ''
  return filename.slice(lastDot)
}

function removeExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot === -1 || lastDot === 0) return filename
  return filename.slice(0, lastDot)
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function VideoNodeComponent({ selected, id, data, width, height }: VideoNodeProps) {
  const extension = data.originalFilename ? getExtensionFromFilename(data.originalFilename) : ''
  const documentName = data.documentName || (data.originalFilename ? removeExtension(data.originalFilename) : 'Video')
  const { onFocusNode } = data
  const [videoError, setVideoError] = useState(false)

  const { data: signedUrl, isLoading, error, refetch } = useSignedUrl(data.storagePath, data.contentHash)

  const nodeWidth = positiveNumber(width) ?? VIDEO_NODE_LAYOUT.DEFAULT_MEASURED.width
  const nodeHeight = positiveNumber(height) ?? VIDEO_NODE_LAYOUT.DEFAULT_MEASURED.height
  const videoHeight = Math.max(0, nodeHeight - NODE_NAME_HEIGHT)

  const handleDoubleClick = useCallback(() => {
    onFocusNode?.(id)
  }, [id, onFocusNode])

  const handleRetry = useCallback(() => {
    setVideoError(false)
    void refetch()
  }, [refetch])

  const handleDownload = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      if (signedUrl) window.open(signedUrl, '_blank')
    },
    [signedUrl]
  )

  const hasError = Boolean(error) || videoError

  return (
    <div className="group relative">
      <DocumentName
        nodeId={id}
        documentName={documentName}
        extension={extension}
        containerStyle={{ width: nodeWidth, maxWidth: nodeWidth }}
      />
      <div className="relative group/video">
        <NodeResizeControl
          position="bottom-right"
          className="!cursor-se-resize !select-none opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto"
          style={controlStyle}
          minWidth={VIDEO_NODE_LAYOUT.MIN_WIDTH}
          minHeight={VIDEO_NODE_LAYOUT.MIN_HEIGHT}
          maxWidth={VIDEO_NODE_LAYOUT.MAX_WIDTH}
          shouldResize={() => true}
          autoScale={false}
        >
          <svg
            width={RESIZE_HANDLE_SIZE}
            height={RESIZE_HANDLE_SIZE}
            viewBox="0 0 26 26"
            fill="none"
            className="pointer-events-none block"
          >
            <path d="M24 2V24H2" stroke="#999" strokeWidth={3} strokeLinecap="square" strokeLinejoin="miter" />
          </svg>
        </NodeResizeControl>

        <div
          className={`relative overflow-hidden rounded-[20px] border bg-editor ${selected ? 'node-card-selected' : 'border-outline'}`}
          style={{ width: nodeWidth, height: videoHeight }}
          onDoubleClick={handleDoubleClick}
        >
          {isLoading && (
            <div className="nodrag absolute inset-0 flex items-center justify-center select-none">
              <div className="flex flex-col items-center gap-2 text-foreground-muted">
                <div className="w-8 h-8 border-2 border-foreground-muted border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Loading video...</span>
              </div>
            </div>
          )}

          {hasError && !isLoading && (
            <div className="nodrag absolute inset-0 flex items-center justify-center select-none">
              <div className="flex flex-col items-center gap-2 text-foreground-muted">
                <i className="fa-solid fa-video-slash text-3xl" />
                <span className="text-sm">Failed to load video</span>
                <button
                  onClick={handleRetry}
                  className="px-3 py-1 text-xs bg-block-highlight hover:bg-outline rounded transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {signedUrl && !hasError && (
            <>
              <button
                type="button"
                onClick={handleDownload}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                className="nodrag absolute top-3 right-3 z-20 flex w-10 h-10 items-center justify-center rounded-xl border border-outline/70 bg-canvas/85 opacity-0 pointer-events-none shadow-sm backdrop-blur-md transition-opacity transition-colors group-hover/video:opacity-100 group-hover/video:pointer-events-auto hover:bg-canvas hover:text-foreground active:scale-[0.98] active:bg-canvas active:shadow-none !cursor-pointer !select-none"
                title="Download video"
                aria-label="Download video"
              >
                <i className="fa-solid fa-download text-base text-foreground/80 pointer-events-none" />
              </button>
              <video
                src={signedUrl}
                controls
                preload="metadata"
                className="nodrag nowheel h-full w-full bg-black object-contain"
                onError={() => setVideoError(true)}
              />
              <div className="pointer-events-none absolute bottom-2 left-3 rounded-md bg-black/60 px-2 py-1 text-[11px] font-medium text-white/80">
                {formatFileSize(data.size)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(VideoNodeComponent)
