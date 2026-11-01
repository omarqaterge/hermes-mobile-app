// Settings → Voice → Speech recognition: which speech-to-text dictation and Live mode use. The phone's own recogniser,
// or an on-device model (the shell's LocalStt): built-in English ones to download, or one the user brings from
// Hugging Face or the phone's files. Each card says what the model is good and weaker at, so the choice is informed.
import { useEffect } from 'react'
import { confirmDialog, promptDialog } from '../dialog'
import {
  addSttModelUrl,
  cancelSttDownload,
  chooseSttModel,
  deleteSttModel,
  downloadSttModel,
  fmtSize,
  loadSttModels,
  pickSttModelFiles,
  testSttModel,
  testSummary,
  useSttModels,
  type SttList,
  type SttModel
} from '../stt'
import { Row, Section } from './ui'

export function SttSettings() {
  const list = useSttModels()
  useEffect(loadSttModels, [])
  if (!list) return <Section footer="On-device speech recognition is available in the Android app."><Row title="Speech recognition" value="Not available here" /></Section>
  const builtIn = list.models.filter(m => !m.custom)
  const own = list.models.filter(m => m.custom)
  const phone = list.chosen === '' || !list.models.some(m => m.id === list.chosen && m.state === 'ready')
  return (
    <>
      <Section footer="Used for dictation and Live mode. The phone’s own recogniser may send your voice to its maker’s servers and needs internet unless it has an offline language pack.">
        <Row icon="📱" tone="blue" title="Phone’s speech recognition" sub="Android’s recogniser (usually Google’s)" value={phone ? '✓ In use' : undefined} onClick={phone ? undefined : () => chooseSttModel('')} />
      </Section>
      <Section
        title="On-device models"
        footer="On-device models run on this phone: your voice never leaves it and they work offline. They use the processor only while the microphone is on. Download one over Wi-Fi: they are 45–140 MB."
      >
        <div className="stt-cards" style={{ display: 'grid', gap: 8, padding: 8 }}>
          {builtIn.map(m => (
            <ModelCard key={m.id} m={m} list={list} />
          ))}
        </div>
      </Section>
      <Section
        title="Your own model"
        footer="Any sherpa-onnx speech model: Moonshine, Whisper, SenseVoice, or a Zipformer, NeMo or Parakeet transducer, in any language. The app recognises the files and tries them on a test recording before using them."
      >
        {own.length > 0 && (
          <div className="stt-cards" style={{ display: 'grid', gap: 8, padding: 8 }}>
            {own.map(m => (
              <ModelCard key={m.id} m={m} list={list} />
            ))}
          </div>
        )}
        {list.importing && <div className="notice">Adding the model{list.importing === 'files' ? ' from your files' : ` from huggingface.co/${list.importing}`}…</div>}
        {list.importError && <div className="notice notice-error">{list.importError}</div>}
        <Row icon="🤗" tone="gold" title="Add from Hugging Face" sub="Paste the model’s link" chevron disabled={Boolean(list.importing)} onClick={() => void addLink()} />
        <Row icon="📁" tone="teal" title="Add files from this phone" sub="The model’s .onnx files and tokens.txt, or a .zip" chevron disabled={Boolean(list.importing)} onClick={pickSttModelFiles} />
      </Section>
    </>
  )
}

async function addLink() {
  const url = await promptDialog({
    title: 'Add a model from Hugging Face',
    message: 'The link of a sherpa-onnx model, for example https://huggingface.co/csukuangfj/sherpa-onnx-whisper-tiny.en',
    placeholder: 'https://huggingface.co/owner/model',
    confirmLabel: 'Add'
  })
  if (url) addSttModelUrl(url)
}

function ModelCard({ m, list }: { m: SttModel; list: SttList }) {
  const inUse = list.chosen === m.id && m.state === 'ready'
  const busy = m.state === 'downloading' || m.state === 'checking'
  const pct = m.total ? Math.min(100, Math.round(((m.done ?? 0) / m.total) * 100)) : 0
  const remove = () =>
    void confirmDialog({ title: `Delete ${m.name}?`, message: `Frees ${fmtSize(m.onDisk ?? m.size)}. You can download it again later.`, confirmLabel: 'Delete', danger: true }).then(ok => {
      if (ok) deleteSttModel(m.id)
    })
  return (
    <div className={`card${inUse ? ' active' : ''}`} aria-label={`Speech model ${m.name}`}>
      <div className="card-head">
        <strong>{m.name}</strong>
        <span className="dim small">{fmtSize(m.onDisk ?? m.size)}</span>
      </div>
      <div className="chips-row" style={{ flexWrap: 'wrap' }}>
        {m.recommended && <span className="tag">Recommended</span>}
        {inUse && <span className="tag">In use</span>}
        <span className={`tag${m.live ? '' : ' off'}`}>{m.live ? 'Words while you speak' : 'Words after each pause'}</span>
        <span className={`tag${m.punctuation ? '' : ' off'}`}>{m.punctuation ? 'Punctuation' : 'No punctuation'}</span>
        {m.custom && m.kind && <span className="tag off">{m.kind}</span>}
      </div>
      {m.good && <div className="card-text">👍 {m.good}</div>}
      {m.weak && <div className="card-text">👎 {m.weak}</div>}
      {m.custom && m.source && <div className="card-text">From {m.source}</div>}
      {m.state === 'downloading' && (
        <div className="usage">
          <div className="usage-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="dim small">
            Downloading… {fmtSize(m.done ?? 0)} of {fmtSize(m.total ?? m.size)}
          </span>
        </div>
      )}
      {m.state === 'checking' && <div className="card-text">Checking the model on a test recording…</div>}
      {m.state === 'failed' && m.error && <div className="card-text danger">{m.error}</div>}
      {m.state === 'ready' && m.test && (
        <div className="card-text">
          Test: {testSummary(m.test, list.sample)}
          {m.test.text ? `\n“${m.test.text}”` : ''}
        </div>
      )}
      <div className="card-actions">
        {m.state === 'none' && <button onClick={() => downloadSttModel(m.id)}>Download {fmtSize(m.size)}</button>}
        {m.state === 'downloading' && <button onClick={() => cancelSttDownload(m.id)}>Cancel</button>}
        {m.state === 'ready' && !inUse && <button onClick={() => chooseSttModel(m.id)}>Use</button>}
        {m.state === 'ready' && <button onClick={() => testSttModel(m.id)}>Test model</button>}
        {m.state === 'failed' && !m.custom && <button onClick={() => downloadSttModel(m.id)}>Try again</button>}
        {m.state === 'failed' && m.custom && <button onClick={() => testSttModel(m.id)}>Test again</button>}
        {(m.state === 'ready' || m.state === 'failed' || (m.custom && !busy)) && (
          <button className="danger" onClick={remove}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}
