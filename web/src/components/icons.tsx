// The one place icons come from. Every icon is a stroke-only 24 x 24 drawing in `currentColor` at one stroke
// weight, sized by the text around it (1em) unless a size is passed, and hidden from screen readers unless it is
// given a label. The shapes are lucide-react's (pinned in package.json; see THIRD_PARTY.md); nothing else in the
// app imports that package, so the set can be swapped here alone. No emoji and no icon glyph (a tick, a cross, an
// arrow standing in for an icon) belongs anywhere else in the interface: tools/check-no-emoji.py enforces it.
import type { ReactNode } from 'react'
import {
  Archive, ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, Ban, Bell, Bird, Bot, Braces, Brain, Brush, Bug, Calendar, ChartColumn,
  Check, ChevronLeft, ChevronDown, ChevronRight, ChevronUp, CircleCheck, Circle, CircleDot, CircleHelp, CircleX, Clock, Quote, CloudDownload,
  Code, Compass, CornerLeftUp, Download, Eye, FastForward, FileText, Film, Folder, FolderOpen, GitBranch, Layers, Gauge,
  Globe, Hand, Hash, House, Image, Info, KeyRound, Link, ListChecks, Lock, LogOut, Mail, MapPin, Maximize2, Minimize2, Menu, MessageSquare,
  Mic, Music, Network, Package, Palette, Paperclip, Pencil, Phone, Pin, Play, Plug, Puzzle, Redo2, RotateCcw, RefreshCw, Rewind,
  Save, Search, SendHorizontal, Settings, Share2, ShieldCheck, SlidersHorizontal, Signal, Smartphone, Sparkles, Square,
  SquareCheck, Star, StickyNote, Stethoscope, Table, Target, Terminal, ThumbsDown, ThumbsUp, Trash2, TriangleAlert, Undo2,
  Upload, Copy, List, ArrowDownToLine, ArrowUpToLine, PanelLeftClose, EllipsisVertical, Plus, Minus, User, Users, Volume2, Wrench, X, Zap, Hourglass
} from 'lucide-react'

const ICONS = {
  archive: Archive, arrowDown: ArrowDown, arrowUp: ArrowUp, sort: ArrowUpDown, external: ArrowUpRight, off: Ban, bell: Bell, bird: Bird,
  bot: Bot, json: Braces, brain: Brain, broom: Brush, bug: Bug, calendar: Calendar, chart: ChartColumn, check: Check,
  down: ChevronDown, right: ChevronRight, left: ChevronLeft, up: ChevronUp, done: CircleCheck, circle: Circle, active: CircleDot, help: CircleHelp,
  failed: CircleX, clock: Clock, quote: Quote, getModel: CloudDownload, code: Code, compass: Compass, back: CornerLeftUp,
  download: Download, eye: Eye, fast: FastForward, file: FileText, film: Film, folder: Folder, folderOpen: FolderOpen,
  branch: GitBranch, layers: Layers, gauge: Gauge, globe: Globe, hand: Hand, hash: Hash, home: House, image: Image, info: Info,
  key: KeyRound, link: Link, checklist: ListChecks, lock: Lock, signOut: LogOut, mail: Mail, mapPin: MapPin, expand: Maximize2, shrink: Minimize2,
  menu: Menu, chat: MessageSquare, mic: Mic, music: Music, subagent: Network, package: Package, palette: Palette,
  clip: Paperclip, pencil: Pencil, phoneCall: Phone, pin: Pin, play: Play, plug: Plug, puzzle: Puzzle, redo: Redo2,
  reset: RotateCcw, refresh: RefreshCw, rewind: Rewind, save: Save, search: Search, send: SendHorizontal, settings: Settings,
  share: Share2, shield: ShieldCheck, sliders: SlidersHorizontal, signal: Signal, phone: Smartphone, sparkles: Sparkles,
  square: Square, squareCheck: SquareCheck, star: Star, note: StickyNote, health: Stethoscope, table: Table, target: Target,
  terminal: Terminal, thumbDown: ThumbsDown, thumbUp: ThumbsUp, trash: Trash2, warning: TriangleAlert, undo: Undo2,
  upload: Upload, copy: Copy, list: List, toBottom: ArrowDownToLine, toTop: ArrowUpToLine, panelClose: PanelLeftClose, plus: Plus, minus: Minus, dots: EllipsisVertical, user: User, users: Users, speaker: Volume2, tool: Wrench, close: X, zap: Zap, hourglass: Hourglass
} as const

export type IconName = keyof typeof ICONS

/** An icon by name. `label` makes it a named image for screen readers; without one it is decoration. */
export function Icon({ n, size = '1em', label, className, strokeWidth = 2 }: { n: IconName; size?: number | string; label?: string; className?: string; strokeWidth?: number }) {
  const Glyph = ICONS[n]
  const cls = className ? `ico ${className}` : 'ico'
  return label ? <Glyph size={size} strokeWidth={strokeWidth} className={cls} role="img" aria-label={label} /> : <Glyph size={size} strokeWidth={strokeWidth} className={cls} aria-hidden="true" />
}

/** What a row, chip or option passes as its `icon`: an icon name draws the icon; anything else is shown as given. */
export function iconOf(i: ReactNode): ReactNode {
  return typeof i === 'string' && i in ICONS ? <Icon n={i as IconName} /> : i
}
