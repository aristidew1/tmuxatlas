import type { HTMLAttributes, ReactNode } from 'react'
import { Activity, Check, CloudOff, Hourglass, Info, Minus, Moon, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'

export type StatusPillVariant = 'neutral' | 'info' | 'running' | 'waiting' | 'idle' | 'done' | 'error' | 'offline'

/** Every status has its own shape, so colour is never the only signal. */
const statusIcons: Record<StatusPillVariant, LucideIcon> = {
  neutral: Minus,
  info: Info,
  running: Activity,
  waiting: Hourglass,
  idle: Moon,
  done: Check,
  error: TriangleAlert,
  offline: CloudOff,
}

export function StatusIcon({
  status,
  size = 14,
  className,
}: {
  status: StatusPillVariant
  size?: number
  className?: string
}) {
  const Icon = statusIcons[status]
  return (
    <Icon
      aria-hidden="true"
      data-status={status}
      size={size}
      strokeWidth={2.25}
      className={cn('ui-status-icon shrink-0', className)}
    />
  )
}

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  status?: StatusPillVariant
  mark?: ReactNode
}

export function StatusPill({ children, className, mark, status = 'neutral', ...props }: StatusPillProps) {
  return (
    <span className={cn('ui-status-pill', className)} data-status={status} {...props}>
      <span className="ui-status-pill__mark" aria-hidden="true">
        {mark ?? <StatusIcon status={status} size={12} />}
      </span>
      <span>{children}</span>
    </span>
  )
}
