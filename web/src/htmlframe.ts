/** Builds the `srcDoc` of the sandboxed HTML frame (canvas page view, inline chat preview, full-screen viewer). */

// First thing in the document, before any script of the page's own: remove the phone bridge, report errors,
// and show alert() in the app's own look (Android's box says "The page at … says").
const GUARD =
  `<script>try{delete window.HermesAndroid}catch(e){}try{window.HermesAndroid=undefined}catch(e){}` +
  `window.addEventListener('error',function(e){parent.postMessage({hmCanvasError:String(e.message)},'*')});` +
  `window.alert=function(m){parent.postMessage({hmCanvasAlert:String(m===undefined?'':m)},'*')};` +
  // Links would load the site inside the frame (sub-frame navigations never reach the Android shell): web and mail
  // links go to the app, which opens them outside; other links stay put (javascript: ones still run, # ones scroll).
  `var hmL=function(u){parent.postMessage({hmCanvasLink:String(u)},'*')},hmOk=function(u){return/^(https?:|mailto:)/i.test(u)};` +
  `document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');` +
  `if(!a||/^\\s*(#|javascript:)/i.test(a.getAttribute('href')))return;e.preventDefault();if(hmOk(a.href))hmL(a.href)},true);` +
  // window.open has no popup to open in a sandbox: hand a web or mail address to the app the same way.
  `window.open=function(u){if(u==null)return null;try{var h=new URL(String(u),document.baseURI).href;if(hmOk(h))hmL(h)}catch(x){}return null};`

// Only for the inline preview: tell the app how tall the page is so the frame can grow to fit.
const HEIGHT =
  `try{var hmH=function(){parent.postMessage({hmFrameHeight:document.documentElement.scrollHeight},'*')};` +
  `new ResizeObserver(hmH).observe(document.documentElement);window.addEventListener('load',hmH)}catch(e){}`

// Offline means offline: default-src doesn't cover form submissions, so they are blocked separately.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'">`

export function frameDoc(html: string, network: boolean, autoHeight = false): string {
  const top = `<meta name="viewport" content="width=device-width,initial-scale=1">${network ? '' : CSP}${GUARD}${autoHeight ? HEIGHT : ''}</script>`
  // The guard must be the very first thing that can run, so it goes right after the doctype (or at the start).
  const dt = /^\s*<!doctype[^>]*>/i.exec(html)
  if (dt) return html.slice(0, dt[0].length) + top + html.slice(dt[0].length)
  return `<!doctype html>${top}${html}`
}

/** The height the frame should take for a reported page height: finite numbers only, clamped to [min, max]. */
export function frameHeight(reported: unknown, min: number, max: number): number | null {
  if (typeof reported !== 'number' || !Number.isFinite(reported)) return null
  return Math.min(max, Math.max(min, Math.ceil(reported)))
}

/** A link the frame asked to open, if it is one the app opens outside: http(s) or mailto, at most 2000 characters
 * (scheme in lower case: the Android shell compares it exactly). */
export function frameLink(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2000 || !/^(?:https?:\/\/|mailto:)\S/i.test(raw)) return null
  return raw.replace(/^[a-z]+:/i, s => s.toLowerCase())
}
