import { Button, Dialog } from './ui'

interface TerminalPasteConfirmationProps {
  text: string
  targetLabel: string
  error?: string
  onConfirm: () => void
  onCancel: () => void
}

export function TerminalPasteConfirmation({
  text,
  targetLabel,
  error,
  onConfirm,
  onCancel,
}: TerminalPasteConfirmationProps) {
  return (
    <Dialog
      open
      closeLabel="Fermer"
      role="alertdialog"
      onOpenChange={open => {
        if (!open) onCancel()
      }}
      title="Coller plusieurs lignes ?"
      description={`Cela enverra ${text.split(/\r\n|\r|\n/).length} lignes à ${targetLabel}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Annuler
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            Coller dans le terminal
          </Button>
        </>
      }
    >
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-background p-3 text-xs text-foreground">
        {text}
      </pre>
      {error && (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
