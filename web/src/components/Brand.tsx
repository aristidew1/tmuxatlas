import { cn } from '../lib/utils'

/** The Atlas mark: three contour lines closing around a summit. */
export function AtlasMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0 text-primary', className)}
    >
      <path d="M5.5 21.5c-2-5 .3-11.2 5.2-14.3 5.2-3.3 12.4-2.6 16 2.2 3.2 4.3 2.4 10.6-1.5 14.6-3.6 3.7-9.3 5-13.8 3" />
      <path d="M10.3 19.7c-1.2-3.4.4-7.3 3.6-9.1 3.4-1.9 7.8-1.1 9.8 2 1.8 2.8 1 6.6-1.6 8.9-2.5 2.2-6 2.7-8.7 1.4" />
      <path d="M15 18.2c-.7-1.7.2-3.6 1.8-4.4 1.7-.8 3.7-.2 4.4 1.3.7 1.6-.1 3.4-1.7 4.2-1.3.6-2.8.4-3.7-.4" />
    </svg>
  )
}

/** Faint, slowly drifting contour lines. Purely decorative. */
export function TopoBackground({ className }: { className?: string }) {
  const rings = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  return (
    <div className={cn('atlas-topo', className)} aria-hidden="true">
      <svg
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      >
        {rings.map(ring => (
          <path
            key={`a${ring}`}
            d={`M${250 - ring * 58} ${400} C ${200 - ring * 70} ${190 - ring * 42}, ${520 + ring * 30} ${110 - ring * 46}, ${720 + ring * 52} ${235 - ring * 34} S ${1040 + ring * 62} ${560 + ring * 30}, ${720 + ring * 40} ${640 + ring * 42} S ${300 - ring * 40} ${660 + ring * 46}, ${250 - ring * 58} ${400} Z`}
          />
        ))}
        {[0, 1, 2, 3].map(ring => (
          <path
            key={`b${ring}`}
            d={`M${520 - ring * 26} ${390} C ${510 - ring * 34} ${300 - ring * 26}, ${640 + ring * 16} ${270 - ring * 24}, ${720 + ring * 28} ${325 - ring * 20} S ${800 + ring * 34} ${470 + ring * 18}, ${660 + ring * 18} ${490 + ring * 24} S ${530 - ring * 24} ${450 + ring * 22}, ${520 - ring * 26} ${390} Z`}
          />
        ))}
      </svg>
    </div>
  )
}
