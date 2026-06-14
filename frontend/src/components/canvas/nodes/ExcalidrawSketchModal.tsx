import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '@excalidraw/excalidraw/index.css'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import type { ThemeMode } from '@/constants/themes'

const ExcalidrawCanvas = lazy(async () => {
  const mod = await import('@excalidraw/excalidraw')
  return { default: mod.Excalidraw }
})

export interface SketchModalResult {
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  svgLight: string
  svgDark: string
}

interface ExcalidrawSketchModalProps {
  elements?: ExcalidrawElement[]
  files?: BinaryFiles
  themeMode: ThemeMode
  onClose: (result: SketchModalResult | null) => void
}

type SketchSceneData = {
  elements: readonly ExcalidrawElement[]
  files: BinaryFiles
  appState: ReturnType<ExcalidrawImperativeAPI['getAppState']>
}

const MAX_SVG_PREVIEW_SIZE = 1024 * 1024

function serializeSvg(svg: SVGSVGElement): string {
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  const xml = new XMLSerializer().serializeToString(svg)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
}

export const ExcalidrawSketchModal = memo(function ExcalidrawSketchModal({
  elements,
  files,
  themeMode,
  onClose,
}: ExcalidrawSketchModalProps) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const latestSceneRef = useRef<SketchSceneData | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  const initialSignature = useMemo(
    () =>
      JSON.stringify({
        elements: elements ?? [],
        files: files ?? {},
      }),
    [elements, files]
  )

  const getCurrentSceneData = useCallback(() => {
    const api = apiRef.current
    if (!api) return latestSceneRef.current

    const apiScene = {
      elements: api.getSceneElements(),
      files: api.getFiles(),
      appState: api.getAppState(),
    }

    const latestScene = latestSceneRef.current
    if (latestScene) {
      return latestScene
    }

    return apiScene
  }, [])

  const handleCloseRequest = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true)
      return
    }
    onClose(null)
  }, [isDirty, onClose])

  const handleSave = useCallback(async () => {
    const scene = getCurrentSceneData()
    if (!scene) {
      onClose(null)
      return
    }

    try {
      const { exportToSvg } = await import('@excalidraw/excalidraw')
      const lightSvg = await exportToSvg({
        elements: scene.elements,
        appState: {
          ...scene.appState,
          exportBackground: true,
          exportWithDarkMode: false,
        },
        files: scene.files,
      })
      const darkSvg = await exportToSvg({
        elements: scene.elements,
        appState: {
          ...scene.appState,
          exportBackground: true,
          exportWithDarkMode: true,
        },
        files: scene.files,
      })

      const svgLight = serializeSvg(lightSvg)
      const svgDark = serializeSvg(darkSvg)
      onClose({
        elements: scene.elements,
        files: scene.files,
        svgLight: svgLight.length <= MAX_SVG_PREVIEW_SIZE ? svgLight : '',
        svgDark: svgDark.length <= MAX_SVG_PREVIEW_SIZE ? svgDark : '',
      })
    } catch (error) {
      console.error('Failed to export sketch preview', error)
      onClose({
        elements: scene.elements,
        files: scene.files,
        svgLight: '',
        svgDark: '',
      })
    }
  }, [getCurrentSceneData, onClose])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (showDiscardConfirm) {
        setShowDiscardConfirm(false)
        return
      }
      handleCloseRequest()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [handleCloseRequest, showDiscardConfirm])

  return createPortal(
    <div className="fixed inset-0 z-[10000] bg-black/70 p-5" onClick={handleCloseRequest}>
      <div
        className="nodrag nowheel flex h-full flex-col overflow-hidden rounded-lg border border-outline bg-editor shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-12 items-center justify-between border-b border-outline px-3">
          <button
            type="button"
            className="rounded-md border border-outline px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground"
            onClick={handleCloseRequest}
          >
            Close
          </button>
          <button
            type="button"
            className="rounded-md bg-primary-button-background px-4 py-1.5 text-sm text-primary-button-text"
            onClick={handleSave}
          >
            Save
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-white">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">Loading sketch</div>
            }
          >
            <ExcalidrawCanvas
              excalidrawAPI={(api) => {
                apiRef.current = api
              }}
              onChange={(nextElements, _nextAppState, nextFiles) => {
                latestSceneRef.current = {
                  elements: nextElements,
                  files: nextFiles,
                  appState: _nextAppState,
                }
                const nextSignature = JSON.stringify({
                  elements: nextElements,
                  files: nextFiles,
                })
                setIsDirty(nextSignature !== initialSignature)
              }}
              initialData={{ elements, files }}
              theme={themeMode}
              detectScroll={false}
              UIOptions={{
                canvasActions: {
                  toggleTheme: false,
                  saveAsImage: false,
                  loadScene: false,
                  export: false,
                },
              }}
            />
          </Suspense>
        </div>
        {showDiscardConfirm ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45">
            <div className="w-[360px] rounded-lg border border-outline bg-editor p-4 shadow-xl">
              <div className="text-base font-semibold text-foreground">Unsaved sketch</div>
              <div className="mt-1 text-sm text-foreground-muted">Save changes before closing?</div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-outline px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground"
                  onClick={() => onClose(null)}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="rounded-md border border-outline px-3 py-1.5 text-sm text-foreground-muted hover:text-foreground"
                  onClick={() => setShowDiscardConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md bg-primary-button-background px-3 py-1.5 text-sm text-primary-button-text"
                  onClick={handleSave}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
})
