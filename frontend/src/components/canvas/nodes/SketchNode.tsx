import { memo, useCallback, useMemo, useState } from 'react'
import type { SketchNode as SketchNodeType, SketchNodeData } from 'shared'
import { SKETCH_NODE_LAYOUT } from 'shared/constants'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles } from '@excalidraw/excalidraw/types'
import type { WithCanvasData } from '../types'
import { DocumentName } from './DocumentName'
import { positiveNodeDimension } from './nodeDimensions'
import { ResizableNodeHandle } from './ResizableNodeHandle'
import { useNodeData } from './useNodeData'
import { ExcalidrawSketchModal, type SketchModalResult } from './ExcalidrawSketchModal'
import { useTheme } from '@/providers/theme'

type SketchNodeProps = WithCanvasData<SketchNodeType>

const SKETCH_MIN_WIDTH = 320
const SKETCH_MIN_HEIGHT = 240
const SKETCH_MAX_WIDTH = 1400
const SKETCH_MAX_HEIGHT = 1000

function cloneJsonArray(value: readonly unknown[]): unknown[] {
  return JSON.parse(JSON.stringify(value)) as unknown[]
}

function cloneJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

export default memo(function SketchNode({ id, data, selected, width, height }: SketchNodeProps) {
  const { documentName = 'Sketch' } = data
  const { themeMode } = useTheme()
  const getNodeData = useNodeData<SketchNodeData>(id, 'sketch')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const nodeWidth = positiveNodeDimension(width) ?? SKETCH_NODE_LAYOUT.DEFAULT_MEASURED.width
  const nodeHeight = positiveNodeDimension(height) ?? SKETCH_NODE_LAYOUT.DEFAULT_MEASURED.height

  const previewSvg =
    themeMode === 'dark' ? data.excalidrawSvgDark || data.excalidrawSvg : data.excalidrawSvgLight || data.excalidrawSvg

  const elements = useMemo(
    () => (Array.isArray(data.excalidrawElements) ? (data.excalidrawElements as ExcalidrawElement[]) : undefined),
    [data.excalidrawElements]
  )
  const files = useMemo(
    () => (data.excalidrawFiles ? (data.excalidrawFiles as BinaryFiles) : undefined),
    [data.excalidrawFiles]
  )

  const handleModalClose = useCallback(
    (result: SketchModalResult | null) => {
      setIsModalOpen(false)
      if (!result) return

      const nodeData = getNodeData()
      if (!nodeData) return

      nodeData.excalidrawElements = cloneJsonArray(result.elements as readonly unknown[])
      nodeData.excalidrawFiles = cloneJsonRecord(result.files as unknown as Record<string, unknown>)
      nodeData.excalidrawSvgLight = result.svgLight
      nodeData.excalidrawSvgDark = result.svgDark
      nodeData.excalidrawSvg = themeMode === 'dark' ? result.svgDark : result.svgLight
    },
    [getNodeData, themeMode]
  )

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-lg border bg-editor shadow-sm ${selected ? 'border-foreground/60' : 'border-outline'}`}
      style={{ width: nodeWidth, height: nodeHeight }}
    >
      <ResizableNodeHandle
        selected={Boolean(selected)}
        minWidth={SKETCH_MIN_WIDTH}
        minHeight={SKETCH_MIN_HEIGHT}
        maxWidth={SKETCH_MAX_WIDTH}
        maxHeight={SKETCH_MAX_HEIGHT}
      />
      <DocumentName
        nodeId={id}
        documentName={documentName}
        extension=".sketch"
        containerStyle={{ maxWidth: Math.max(150, nodeWidth - 50) }}
      />
      <button
        type="button"
        className="nodrag nowheel mx-4 mb-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-outline bg-canvas text-foreground-muted transition-colors hover:text-foreground"
        onClick={() => setIsModalOpen(true)}
        onDoubleClick={() => setIsModalOpen(true)}
      >
        {previewSvg ? (
          <img src={previewSvg} alt="" className="h-full w-full object-contain" draggable={false} />
        ) : (
          <div className="flex flex-col items-center gap-3">
            <i className="fa-solid fa-pen-nib text-3xl" />
            <span className="text-sm">Sketch</span>
          </div>
        )}
      </button>

      {isModalOpen ? (
        <ExcalidrawSketchModal elements={elements} files={files} themeMode={themeMode} onClose={handleModalClose} />
      ) : null}
    </div>
  )
})
