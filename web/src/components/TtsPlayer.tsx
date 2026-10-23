import { useEffect, useState } from 'react'
import { haptic } from '../bridge'
import { jumpSpeaking, pauseSpeaking, readingClock, resumeSpeaking, seekSpeaking, setReadingSpeed, stopSpeaking, ttsConfig, useVoice } from '../voice'

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2]
const fmt = (r: number) => `${Number(r.toFixed(2))}×`

/** Pop-up player above the composer while a reply is read aloud: pause / resume, speed, scrub through the text. */
export function TtsPlayer() {
  const [flash, setFlash] = useState<{ text: string; n: number } | null>(null)
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash(null), 700)
    return () => clearTimeout(t)
  }, [flash])
  const p = useVoice(v => v.player)
  useVoice(v => v.catalog) // re-render when settings change the rate elsewhere
  if (!p) return null
  const rate = ttsConfig().rate
  const nextSpeed = () => SPEEDS.find(x => x > rate + 0.01) ?? SPEEDS[0]
  const jump = (dir: -1 | 1) => { haptic(); jumpSpeaking(dir); setFlash({ text: dir < 0 ? '-5 s' : '+5 s', n: (flash?.n ?? 0) + 1 }) }
  const pct = p.total > 0 ? (p.pos / p.total) * 100 : 0
  return (
    <div className="tts-player" role="region" aria-label="Reading aloud">
      <button className="tts-btn" aria-label={p.paused ? 'Resume reading' : 'Pause reading'} onClick={() => { haptic(); p.paused ? resumeSpeaking() : pauseSpeaking() }}>
        {p.paused ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        )}
      </button>
      <button className="tts-btn" aria-label="Back 5 seconds" onClick={() => jump(-1)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M11 18V6l-8.5 6zM21 18V6l-8.5 6z" /></svg>
      </button>
      <button className="tts-btn" aria-label="Forward 5 seconds" onClick={() => jump(1)}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M13 6v12l8.5-6zM3 6v12l8.5-6z" /></svg>
      </button>
      <div className="tts-mid">
        <input
          className="slider tts-seek"
          type="range"
          min={0}
          max={Math.max(1, p.total)}
          step={1}
          value={Math.min(p.pos, p.total)}
          style={{ ['--pct' as string]: `${pct}%` }}
          aria-label="Reading position"
          onChange={e => seekSpeaking(Number(e.target.value))}
        />
        <div className="tts-time" aria-live="off">
          <span>{readingClock(Math.min(p.pos, p.total), p.total)}</span>
          {flash && <span className="tts-flash" key={flash.n}>{flash.text}</span>}
        </div>
      </div>
      <button className="tts-speed" aria-label={`Reading speed ${fmt(rate)}, tap to change`} onClick={() => { haptic(); setReadingSpeed(nextSpeed()) }}>
        {fmt(rate)}
      </button>
      <button className="tts-btn" aria-label="Close player" onClick={() => { haptic(); stopSpeaking() }}>
        ✕
      </button>
    </div>
  )
}
