import { useContext, useEffect, useMemo, useState } from 'react'
import { haptic, isNative } from '../bridge'
import { GuardCtx, confirmAddress, openChecked } from '../phone-data-taint'
import { embedOf, embedsInText, frameEmbed, frameSrc, type VideoEmbed } from '../videoembed'
import { Media } from './Media'

// Only one plays at a time: starting a player stops the one before it.
let stopCurrent: (() => void) | null = null

/** A video in the chat: a card that loads nothing of the site's player until tapped, then the site's own player in a
 *  frame. The sandbox leaves out `allow-popups` and `allow-top-navigation`: nothing in the frame can replace the app's page
 *  or open another. `allow-same-origin` only gives the frame its own site's storage; it is never the app's origin. */
export function VideoPlayer({ embed }: { embed: VideoEmbed }) {
  const [playing, setPlaying] = useState(false)
  const guarded = useContext(GuardCtx) // a chat that has read phone data: no thumbnail, and an address check before anything loads

  useEffect(() => {
    if (!playing) return
    const stop = () => setPlaying(false)
    stopCurrent?.()
    stopCurrent = stop
    // Out of the app (home, another app, screen off) there would be sound with no way to stop it.
    const onVisibility = () => {
      if (document.hidden) stop()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (stopCurrent === stop) stopCurrent = null
    }
  }, [playing])

  if (embed.file) return <Media src={embed.src} alt={embed.label} />

  return (
    <div className="video-embed" onClick={e => e.stopPropagation()}>
      <div className="video-embed-stage">
        {playing ? (
          <iframe
            src={frameSrc(embed.src, isNative)}
            title={`Video from ${embed.label}`}
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <button
            className="video-embed-play"
            aria-label={`Play video from ${embed.label}`}
            onClick={() => {
              haptic()
              void confirmAddress(embed.url, guarded, 'Load this video?').then(ok => ok && setPlaying(true))
            }}
          >
            {embed.thumb && !guarded && <img src={embed.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />}
            <span className="video-embed-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </button>
        )}
      </div>
      <div className="video-embed-bar">
        <span className="video-embed-label">{embed.label}</span>
        {playing && (
          <button
            aria-label="Stop video"
            onClick={() => {
              haptic()
              setPlaying(false)
            }}
          >
            Stop
          </button>
        )}
        <button
          aria-label={`Open in ${embed.label}`}
          onClick={() => {
            haptic()
            setPlaying(false)
            void openChecked(embed.url, guarded)
          }}
        >
          Open
        </button>
      </div>
    </div>
  )
}

/** The element `rehypeVideoEmbeds` leaves in a reply. Its address is checked again here. */
export function VideoEmbedTag({ 'data-url': url, 'data-frame': frame }: { 'data-url'?: string; 'data-frame'?: string }) {
  const embed = useMemo(() => (url ? (frame ? frameEmbed(url) : embedOf(url)) : null), [url, frame])
  return embed ? <VideoPlayer embed={embed} /> : null
}

/** The players for the video links in a message of plain text (the user's own bubble). */
export function VideoEmbeds({ text }: { text: string }) {
  const embeds = useMemo(() => embedsInText(text), [text])
  return (
    <>
      {embeds.map(e => (
        <VideoPlayer key={e.src} embed={e} />
      ))}
    </>
  )
}
