import { Inbox, List, Activity, Settings, Shield } from 'lucide-react'
import type { AccountRole } from '../hooks/useAuth'

export function MobileNav({
  currentView,
  attentionCount,
  role,
  onOverview,
  onSessions,
  onMonitoring,
  onAdmin,
  onSettings,
}: {
  currentView: string
  attentionCount: number
  role?: AccountRole | null
  onOverview: () => void
  onSessions: () => void
  onMonitoring: () => void
  onAdmin?: () => void
  onSettings: () => void
}) {
  const items = [
    { label: 'À traiter', icon: Inbox, action: onOverview, active: currentView === 'overview' },
    { label: 'Sessions', icon: List, action: onSessions, active: false },
    ...(role !== 'user'
      ? [{ label: 'Monitoring', icon: Activity, action: onMonitoring, active: currentView === 'monitoring' }]
      : []),
    ...(role === 'admin' && onAdmin
      ? [{ label: 'Administration', icon: Shield, action: onAdmin, active: currentView === 'admin' }]
      : []),
    { label: 'Réglages', icon: Settings, action: onSettings, active: currentView === 'settings' },
  ]
  return (
    <nav
      aria-label="Navigation mobile"
      className="flex shrink-0 border-t border-border bg-card pb-[var(--safe-area-inset-bottom)] md:hidden"
    >
      {items.map(({ label, icon: Icon, action, active }) => (
        <button
          key={label}
          type="button"
          onClick={action}
          aria-current={active ? 'page' : undefined}
          className={`ui-focus-ring flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1 text-2xs ${active ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          <span className="flex items-center gap-1">
            <Icon size={16} aria-hidden />
            {label === 'À traiter' && attentionCount > 0 && (
              <span className="tabular-nums text-warning">{attentionCount}</span>
            )}
          </span>
          {label}
        </button>
      ))}
    </nav>
  )
}
