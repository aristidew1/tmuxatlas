import { useState, type FormEvent } from 'react'
import { KeyRound, LogIn } from 'lucide-react'
import { AtlasMark, TopoBackground } from './Brand'
import { Button } from './ui'

interface LoginProps {
  mode: 'setup' | 'login' | 'accounts'
  error: string | null
  rpId?: string | null
  origin?: string | null
  onSubmit: (firstArg: string, secondArg?: string) => Promise<boolean>
}

export function Login({ mode, error, rpId, origin, onSubmit }: LoginProps) {
  const [setupToken, setSetupToken] = useState('')
  const [label, setLabel] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isSetup = mode === 'setup'
  const isAccounts = mode === 'accounts'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    if (isSetup && !setupToken.trim()) return
    if (isAccounts && (!username.trim() || !password)) return
    setSubmitting(true)
    try {
      if (isAccounts) {
        await onSubmit(username.trim(), password)
      } else {
        await onSubmit(setupToken, label)
      }
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
            {isAccounts
              ? 'Entrez vos identifiants pour accéder à vos sessions Atlas.'
              : 'Utilisez une passkey pour accéder à Atlas.'}
          </p>
          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            {isAccounts && (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="login-username" className="block text-xs text-muted-foreground">
                    Nom d’utilisateur
                  </label>
                  <input
                    id="login-username"
                    name="username"
                    type="text"
                    value={username}
                    onChange={event => setUsername(event.target.value)}
                    placeholder="Nom d’utilisateur"
                    autoComplete="username"
                    autoFocus
                    spellCheck={false}
                    required
                    className="ui-focus-ring min-h-11 w-full rounded bg-input px-3 text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="login-password" className="block text-xs text-muted-foreground">
                    Mot de passe
                  </label>
                  <input
                    id="login-password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    placeholder="Mot de passe"
                    autoComplete="current-password"
                    required
                    className="ui-focus-ring min-h-11 w-full rounded bg-input px-3 text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              </>
            )}
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
              disabled={(isSetup && !setupToken.trim()) || (isAccounts && (!username.trim() || !password))}
              loading={submitting}
              loadingLabel={
                isAccounts
                  ? 'Connexion en cours…'
                  : isSetup
                    ? 'Création de la passkey…'
                    : 'En attente de la passkey…'
              }
              leadingIcon={isAccounts ? <LogIn size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
            >
              {isAccounts ? 'Se connecter' : isSetup ? 'Créer la passkey' : 'Se connecter avec une passkey'}
            </Button>
          </form>
          {!isAccounts && (
            <>
              <details className="mt-5 text-xs text-muted-foreground">
                <summary className="ui-focus-ring cursor-pointer py-2">Comment utiliser une passkey ?</summary>
                <p className="pt-2 leading-relaxed">
                  Utilisez cet appareil, un gestionnaire de mots de passe ou un autre appareil en scannant son code QR.
                </p>
              </details>
              {(rpId || origin) && (
                <p className="mt-4 break-all text-2xs text-muted-foreground">Domaine de la passkey : {rpId || origin}</p>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}
