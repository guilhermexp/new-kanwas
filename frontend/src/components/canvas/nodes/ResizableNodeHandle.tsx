import type { CSSProperties } from 'react'
import { NodeResizeControl } from '@xyflow/react'
import { ResizeHandle, RESIZE_HANDLE_SIZE } from './ResizeHandle'

const controlStyle: CSSProperties = {
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

interface ResizableNodeHandleProps {
  selected: boolean
  minWidth: number
  minHeight: number
  maxWidth?: number
  maxHeight?: number
  color?: string
}

export function ResizableNodeHandle({
  selected,
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  color = '#999',
}: ResizableNodeHandleProps) {
  const visibilityClassName = selected
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto'

  return (
    <NodeResizeControl
      position="bottom-right"
      className={`!cursor-se-resize !select-none transition-opacity ${visibilityClassName}`}
      style={controlStyle}
      minWidth={minWidth}
      minHeight={minHeight}
      maxWidth={maxWidth}
      maxHeight={maxHeight}
      shouldResize={() => true}
      autoScale={false}
    >
      <ResizeHandle color={color} />
    </NodeResizeControl>
  )
}
