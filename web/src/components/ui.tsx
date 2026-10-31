// The app's own form controls. Nothing here uses the browser/Android defaults (no <select>, no native
// range or checkbox): every picker, slider and switch is drawn in the app's visual language.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { haptic } from '../bridge'
import { useBackHandler } from '../backstack'
import { useSheetDrag } from './useSheetDrag'

// ── grouped settings lists ──────────────────────────────────

export function Section({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-section">
      {title && <h3 className="set-heading">{title}</h3>}
      <div className="set-card">{children}</div>
      {footer && <div className="set-foot">{footer}</div>}
    </section>
  )
}

export type Tone = 'gold' | 'blue' | 'green' | 'purple' | 'red' | 'gray' | 'teal'

export function IconChip({ children, tone = 'gray' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={`set-icon tone-${tone}`} aria-hidden="true">
      {children}
    </span>
  )
}

/** One row of a Section: icon, title, optional subtitle, and a value / chevron / control on the right. */
export function Row({
  icon,
  tone,
  title,
  sub,
  value,
  onClick,
  chevron,
  trailing,
  danger,
  disabled
}: {
  icon?: ReactNode
  tone?: Tone
  title: ReactNode
  sub?: ReactNode
  value?: ReactNode
  onClick?: () => void
  chevron?: boolean
  trailing?: ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  const body = (
    <>
      {icon != null && <IconChip tone={danger ? 'red' : tone}>{icon}</IconChip>}
      <span className="set-text">
        <span className={`set-title${danger ? ' danger' : ''}`}>{title}</span>
        {sub != null && <span className="set-sub">{sub}</span>}
      </span>
      {value != null && <span className="set-value">{value}</span>}
      {trailing}
      {chevron && <span className="set-chev">›</span>}
    </>
  )
  return onClick ? (
    <button className="set-row" onClick={() => { haptic(); onClick() }} disabled={disabled}>
      {body}
    </button>
  ) : (
    <div className="set-row static">{body}</div>
  )
}

// ── switch ───────────────────────────────────────────────────

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch${on ? ' on' : ''}`}
      onClick={e => {
        e.stopPropagation()
        haptic()
        onChange(!on)
      }}
    >
      <span />
    </button>
  )
}

/** A Row whose whole width toggles a switch. */
export function ToggleRow({ icon, tone, title, sub, on, onChange }: { icon?: ReactNode; tone?: Tone; title: ReactNode; sub?: ReactNode; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="set-row" role="presentation" onClick={() => { haptic(); onChange(!on) }}>
      {icon != null && <IconChip tone={tone}>{icon}</IconChip>}
      <span className="set-text">
        <span className="set-title">{title}</span>
        {sub != null && <span className="set-sub">{sub}</span>}
      </span>
      <Toggle on={on} onChange={onChange} label={typeof title === 'string' ? title : 'Toggle'} />
    </div>
  )
}

// ── picker (replaces <select>) ───────────────────────────────

export interface Option {
  value: string
  label: string
  sub?: string
  group?: string
  /** Optional icon chip in front (same chips as Settings rows). */
  icon?: ReactNode
  tone?: Tone
}

/** Bottom-sheet list with a check on the current choice. */
export function PickerSheet({ title, options, value, onPick, onClose }: { title: string; options: Option[]; value: string; onPick: (v: string) => void; onClose: () => void }) {
  const drag = useSheetDrag(onClose)
  useBackHandler(onClose)
  const groups: Array<[string, Option[]]> = []
  for (const o of options) {
    const g = o.group || ''
    const last = groups[groups.length - 1]
    if (last && last[0] === g) last[1].push(o)
    else groups.push([g, [o]])
  }
  return (
    <div className="sheet-backdrop picker-backdrop" onClick={onClose}>
      <div className="sheet picker" role="dialog" ref={drag.ref} {...drag.bind} onClick={e => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-title">{title}</div>
        <div className="picker-list">
          {groups.map(([g, list]) => (
            <div key={g || '_'}>
              {g && <div className="picker-group">{g}</div>}
              {list.map(o => (
                <button
                  key={o.value}
                  className={`picker-opt${o.value === value ? ' on' : ''}`}
                  onClick={() => {
                    haptic()
                    onPick(o.value)
                    onClose()
                  }}
                >
                  {o.icon != null && <IconChip tone={o.tone}>{o.icon}</IconChip>}
                  <span className="set-text">
                    <span className="set-title">{o.label}</span>
                    {o.sub && <span className="set-sub">{o.sub}</span>}
                  </span>
                  <span className="picker-check">{o.value === value ? '✓' : ''}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** A Row that shows the current choice and opens a PickerSheet. */
export function SelectRow({ icon, tone, title, options, value, onChange, placeholder }: { icon?: ReactNode; tone?: Tone; title: string; options: Option[]; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false)
  const cur = options.find(o => o.value === value)
  return (
    <>
      <Row icon={icon} tone={tone} title={title} sub={cur?.label ?? placeholder ?? '—'} chevron onClick={() => setOpen(true)} />
      {open && <PickerSheet title={title} options={options} value={value} onPick={onChange} onClose={() => setOpen(false)} />}
    </>
  )
}

// ── slider (replaces <input type=range>) ─────────────────────

export function SliderRow({ icon, tone, title, value, min, max, step, format, onChange }: { icon?: ReactNode; tone?: Tone; title: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="set-row slider-row">
      <div className="slider-head">
        {icon != null && <IconChip tone={tone}>{icon}</IconChip>}
        <span className="set-title">{title}</span>
        <span className="set-value strong">{format(value)}</span>
      </div>
      <input
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: `${pct}%` }}
        aria-label={title}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

// ── segmented choice ─────────────────────────────────────────

export function Segmented<T extends string | number>({ options, value, onChange }: { options: Array<{ value: T; label: ReactNode }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map(o => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => { haptic(); onChange(o.value) }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}


// ── motion ──────────────────────────────────────────────────

const COLLAPSE_MS = 180
const COLLAPSE_EASE = 'cubic-bezier(.2,.8,.2,1)'

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Slides its children open and closed (height and opacity, Web Animations API). Under reduced motion it mounts and unmounts at once. */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const el = useRef<HTMLDivElement>(null)
  const anim = useRef<Animation | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const first = useRef(true)
  if (open && !mounted) setMounted(true)

  useLayoutEffect(() => {
    const node = el.current
    const wasFirst = first.current
    first.current = false
    const stop = () => {
      window.clearTimeout(timer.current)
      anim.current?.cancel()
      anim.current = null
      if (node) node.style.overflow = ''
    }
    if (!node || wasFirst || typeof node.animate !== 'function' || reducedMotion()) {
      stop()
      if (!open) setMounted(false)
      return stop
    }
    const from = node.getBoundingClientRect().height
    const fromOp = Number(getComputedStyle(node).opacity) || 0
    stop()
    node.style.overflow = 'hidden'
    const to = open ? node.scrollHeight : 0
    const a = node.animate(
      [{ height: `${from}px`, opacity: fromOp }, { height: `${to}px`, opacity: open ? 1 : 0 }],
      { duration: COLLAPSE_MS, easing: COLLAPSE_EASE }
    )
    anim.current = a
    const done = () => {
      if (anim.current !== a) return
      window.clearTimeout(timer.current)
      anim.current = null
      a.cancel()
      node.style.overflow = ''
      if (!open) setMounted(false)
    }
    a.onfinish = done
    timer.current = window.setTimeout(done, COLLAPSE_MS + 100)
    return () => {
      // A flip during the animation re-runs the effect, which starts from the current height.
      window.clearTimeout(timer.current)
    }
  }, [open])

  if (!mounted) return null
  return (
    <div ref={el} className="collapse">
      {children}
    </div>
  )
}

/** A right-pointing chevron that turns 90 degrees when open. */
export function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
