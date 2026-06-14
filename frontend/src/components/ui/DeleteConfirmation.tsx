import { createPortal } from 'react-dom'

interface DeleteConfirmationProps {
  onDelete: () => void
  onCancel: () => void
}

export const DeleteConfirmation = ({ onDelete, onCancel }: DeleteConfirmationProps) => {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas-background/55">
      <div className="flex items-center gap-6 rounded-lg border border-outline bg-editor px-4 py-3 text-foreground shadow-2xl animate-[scaleIn_0.2s_ease-out]">
        <span className="text-md font-bold text-foreground">Sure want to delete?</span>
        <button
          onClick={onDelete}
          className="text-md cursor-pointer font-medium text-status-error transition-opacity hover:opacity-80"
        >
          Delete
        </button>
        <button
          onClick={onCancel}
          className="text-md cursor-pointer rounded-md border border-primary-button-outline bg-primary-button-background px-6 py-2 font-medium text-primary-button-foreground transition-colors hover:bg-primary-button-active-background"
        >
          No
        </button>
      </div>
    </div>,
    document.body
  )
}
