import { useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { AtlasMark, TopoBackground } from './Brand'
import { Button } from './ui'

interface LoginProps {
  mode: 'setup' | 'login'
  error: string | null
  rpId?: string | null
  origin?: string | null
  onSubmit: (setupToken: string, label?: string) => Promise<boolean>
}

export function Login({ mode, error, rpId, origin, onSubmit }: LoginProps) {
  const [setupToken, setSetupToken] = useState('')
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isSetup = mode === 'setup'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting || (isSetup && !setupToken.trim())) return
    setSubmitting(true)
    try {
      await onSubmit(setupToken, label)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="app-shell relative flex items-center justify-center overflow-y-auto bg-background p-4 text-sm text-foreground">
      <TopoBackground />
      <div className="relative z-10 w-full max-w-sm py-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <AtlasMark size={56} />
          <h1 className="mt-4 text-2xl tracking-tight">Atlas</h1>
          <p className="mt-2 text-sm text-muted-foreground">Vos sessions et vos agents, réunis au même endroit.</p>
        </div>
        <section className="atlas-surface rounded-xl p-5 sm:p-6">
          <h2 className="text-sm font-medium">{isSetup ? 'Créer la passkey administrateur' : 'Se connecter'}</h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Utilisez une passkey pour accéder à Atlas.
          </p>
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            {isSetup && (
              <>
                <input
                  type="text"
                  value={setupToken}
                  onChange={event => setSetupToken(event.target.value)}
                  placeholder="Jeton de configuration"
                  aria-label="Jeton de configuration"
                  autoComplete="off"
                  autoFocus
                  spellCheck={false}
                  className="ui-focus-ring min-h-11 w-full rounded bg-input px-3 text-foreground placeholder:text-muted-foreground"
                />
                <input
                  type="text"
                  value={label}
                  onChange={event => setLabel(event.target.value)}
                  placeholder="Libellé de la passkey (facultatif)"
                  aria-label="Libellé de la passkey (facultatif)"
                  autoComplete="off"
                  className="ui-focus-ring min-h-11 w-full rounded bg-input px-3 text-foreground placeholder:text-muted-foreground"
                />
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={isSetup && !setupToken.trim()}
              loading={submitting}
              loadingLabel={isSetup ? 'Création de la passkey…' : 'En attente de la passkey…'}
              leadingIcon={<KeyRound size={16} aria-hidden="true" />}
            >
              {isSetup ? 'Créer la passkey' : 'Se connecter avec une passkey'}
            </Button>
          </form>
          <details className="mt-5 text-xs text-muted-foreground">
            <summary className="ui-focus-ring cursor-pointer py-2">Comment utiliser une passkey ?</summary>
            <p className="pt-2 leading-relaxed">
              Utilisez cet appareil, un gestionnaire de mots de passe ou un autre appareil en scannant son code QR.
            </p>
          </details>
          {(rpId || origin) && (
            <p className="mt-4 break-all text-2xs text-muted-foreground">Domaine de la passkey : {rpId || origin}</p>
          )}
        </section>
      </div>
    </main>
  )
}
