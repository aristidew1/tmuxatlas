import { useState, useEffect, useRef } from 'react'
import type { Host } from '../hooks/useHosts'
import { useHostLabel } from '../lib/hostLabel'
import { getBrandStorage, setBrandStorage } from '../lib/brandStorage'
import { fetchProjectDirectories, type NewSessionAgent, type ProjectDirectory } from '../lib/sessionApi'
import { Button, Dialog } from './ui'

interface NewSessionModalProps {
  hosts: Host[]
  onCreateSession: (name: string, hostId: string, options?: { cwd?: string; agent?: NewSessionAgent }) => void
  onClose: () => void
}

const agents = ['', 'claude', 'codex', 'opencode', 'copilot'] as const
const agentLabels = ['Aucun', 'Claude', 'Codex', 'OpenCode', 'Copilot']

export function NewSessionModal({ hosts, onCreateSession, onClose }: NewSessionModalProps) {
  const hostLabel = useHostLabel()
  const onlineHosts = hosts.filter(h => h.online)
  const [selectedHost, setSelectedHost] = useState(() => onlineHosts.find(h => h.local)?.id || onlineHosts[0]?.id || '')
  const [name, setName] = useState('')
  const [cwd, setCwd] = useState(() => getBrandStorage('new-session-directory') || '')
  const [agent, setAgent] = useState<(typeof agents)[number]>(() => {
    const saved = getBrandStorage('new-session-agent')
    return agents.find(value => value === saved) || ''
  })
  const [directories, setDirectories] = useState<ProjectDirectory[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!onlineHosts.some(host => host.id === selectedHost))
      setSelectedHost(onlineHosts.find(h => h.local)?.id || onlineHosts[0]?.id || '')
  }, [hosts, selectedHost])

  useEffect(() => {
    setDirectories([])
    if (!selectedHost) return
    const controller = new AbortController()
    fetchProjectDirectories(selectedHost, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setDirectories(result)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [selectedHost])

  const handleSubmit = () => {
    if (!name.trim() || !selectedHost) return
    setBrandStorage('new-session-directory', cwd.trim())
    setBrandStorage('new-session-agent', agent)
    onCreateSession(name.trim(), selectedHost, { ...(cwd.trim() && { cwd: cwd.trim() }), ...(agent && { agent }) })
  }
  const chooseDirectory = (directory: ProjectDirectory) => {
    setCwd(directory.path)
    setName(
      current =>
        current || (directory.name || directory.path.split('/').filter(Boolean).pop() || '').replace(/[.:]/g, '-'),
    )
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose()
      }}
      title="Nouvelle session"
      description="Créez une session tmux sur un hôte disponible."
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!name.trim() || !selectedHost}>
            Créer
          </Button>
        </>
      }
    >
      <div
        className="space-y-4"
        onKeyDown={event => {
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
            event.preventDefault()
            handleSubmit()
          }
        }}
      >
        <label className="block text-xs text-muted-foreground">
          Nom de la session
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nom de la session"
            className="mt-1 min-h-11 w-full rounded border border-border bg-input px-3 text-sm text-foreground ui-focus-ring"
          />
        </label>
        {onlineHosts.length > 1 && (
          <label className="block text-xs text-muted-foreground">
            Hôte
            <select
              value={selectedHost}
              onChange={e => setSelectedHost(e.target.value)}
              className="mt-1 min-h-11 w-full rounded border border-border bg-input px-3 text-sm text-foreground ui-focus-ring"
            >
              {onlineHosts.map(h => (
                <option key={h.id} value={h.id} title={h.id}>
                  {hostLabel(h.id, h.name === h.id ? 'Hôte' : h.name)}
                  {h.local ? ' (local)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-xs text-muted-foreground">
          Dossier
          <input
            value={cwd}
            onChange={e => setCwd(e.target.value)}
            placeholder="Chemin du dossier (facultatif)"
            className="mt-1 min-h-11 w-full rounded border border-border bg-input px-3 font-mono text-sm text-foreground ui-focus-ring"
          />
        </label>
        {directories.length > 0 && (
          <div aria-label="Suggestions de dossiers" className="max-h-36 overflow-y-auto">
            {directories.map(directory => (
              <button
                type="button"
                key={directory.path}
                onClick={() => chooseDirectory(directory)}
                title={directory.path}
                className="block min-h-11 w-full truncate rounded px-3 text-left text-sm hover:bg-muted ui-focus-ring"
              >
                {directory.name} <span className="font-mono text-xs text-muted-foreground">{directory.path}</span>
              </button>
            ))}
          </div>
        )}
        <fieldset>
          <legend className="mb-2 text-xs text-muted-foreground">Agent</legend>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {agents.map((value, index) => (
              <button
                type="button"
                key={value}
                aria-pressed={agent === value}
                onClick={() => setAgent(value)}
                className={`min-h-11 rounded px-3 text-xs ui-focus-ring ${agent === value ? 'bg-background text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {agentLabels[index]}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </Dialog>
  )
}
