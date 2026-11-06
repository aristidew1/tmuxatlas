import { useState } from 'react'
import { usePasskeys, type PasskeyMetadata } from '../hooks/usePasskeys'

function formatDate(value?: string) {
  if (!value) return 'Jamais'
  return new Date(value).toLocaleString()
}

function PasskeyRow({
  item,
  only,
  pending,
  onRenommer,
  onSupprimer,
}: {
  item: PasskeyMetadata
  only: boolean
  pending: boolean
  onRenommer: (label: string) => Promise<boolean>
  onSupprimer: () => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(item.label)
  const [validation, setValidation] = useState<string | null>(null)

  const save = async () => {
    const normalized = label.trim()
    if (!normalized || [...normalized].length > 80) {
      setValidation('Le nom doit contenir entre 1 et 80 caractères')
      return
    }
    if (await onRenommer(normalized)) {
      setEditing(false)
      setValidation(null)
    }
  }

  const remove = async () => {
    if (only || !window.confirm(`Supprimer ${item.label || 'cette passkey'} ?`)) return
    await onSupprimer()
  }

  return (
    <li className="border-b border-border py-3" data-testid="passkey-row">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex gap-2">
              <input
                aria-label="Nom de la passkey"
                value={label}
                maxLength={80}
                onChange={event => setLabel(event.target.value)}
                className="min-w-0 flex-1 bg-input border border-border rounded px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
              />
              <button
                onClick={save}
                disabled={pending}
                className="px-2 py-1 rounded border border-primary text-primary text-xs disabled:opacity-50"
              >
                Enregistrer
              </button>
              <button
                onClick={() => {
                  setEditing(false)
                  setLabel(item.label)
                  setValidation(null)
                }}
                className="px-2 py-1 text-xs text-muted-foreground"
              >
                Annuler
              </button>
            </div>
          ) : (
            <div className="text-sm text-foreground break-all">{item.label || 'Passkey sans nom'}</div>
          )}
          {validation && (
            <p role="alert" className="text-xs text-destructive mt-1">
              {validation}
            </p>
          )}
          <div className="text-2xs font-normal text-muted-foreground mt-1">
            Ajoutée le {formatDate(item.created_at)} · Dernière utilisation : {formatDate(item.last_used_at)}
          </div>
        </div>
        {!editing && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setEditing(true)}
              disabled={pending}
              className="text-xs text-primary disabled:opacity-50"
            >
              Renommer
            </button>
            <button
              onClick={remove}
              disabled={pending || only}
              title={only ? 'La dernière passkey ne peut pas être supprimée' : 'Supprimer la passkey'}
              className="text-xs text-destructive disabled:opacity-40"
            >
              Supprimer
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

export function PasskeySettings() {
  const { passkeys, loading, pending, error, add, rename, remove } = usePasskeys()
  const [newLabel, setNewLabel] = useState('')

  const addPasskey = async () => {
    if (await add(newLabel)) setNewLabel('')
  }

  return (
    <div className="flex flex-col gap-3" aria-labelledby="passkeys-heading">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div id="passkeys-heading" className="text-sm text-foreground">
            Passkeys
          </div>
          <p className="text-xs font-normal text-muted-foreground mt-0.5">
            Ajoutez une passkey de secours avant d’en supprimer une.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            aria-label="Nom de la nouvelle passkey"
            value={newLabel}
            maxLength={80}
            onChange={event => setNewLabel(event.target.value)}
            placeholder="Nom (facultatif)"
            className="w-36 bg-input border border-border rounded px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={addPasskey}
            disabled={pending !== null}
            className="px-3 py-1.5 rounded text-xs border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
          >
            {pending === 'add' ? 'Ajout…' : 'Ajouter une passkey'}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs font-normal text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-xs font-normal text-muted-foreground">Chargement des passkeys…</p>
      ) : passkeys.length === 0 ? (
        <p className="text-xs font-normal text-muted-foreground">Aucune passkey trouvée.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {passkeys.map(item => (
            <PasskeyRow
              key={item.id}
              item={item}
              only={passkeys.length === 1}
              pending={pending === item.id}
              onRenommer={label => rename(item.id, label)}
              onSupprimer={() => remove(item.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
