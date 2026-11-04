import { useEffect, useRef, useState } from 'react'
import type { ServerRequest } from '@hermes/shared/json-rpc-channel'
import type { ApprovalChoice, ClarifyQuestion } from '@hermes/shared/gateway-contract.generated'
import { answerRequest, rejectRequest } from '../gateway'
import { haptic } from '../bridge'
import { Linked } from './Linked'
import { phoneDataTextOf, phoneDataView, splitUntrusted } from '../phone-data-request'
import { tidyApprovalText } from '../text'
import { useBackHandler } from '../backstack'
import { ADVANCE_MS, nextStep } from '../clarify'

const CHOICE_LABEL: Record<ApprovalChoice, string> = {
  once: 'Allow once',
  session: 'Allow this session',
  always: 'Always allow',
  deny: 'Deny'
}

/** A phone-data read (contacts, calendar, calls, messages, location, photos): the app's own wording, written from the
 *  decoded request and shown as text only, never the plugin's text; only Allow once and Deny. A request that can't be
 *  parsed shows a warning and Deny only. */
function PhoneDataApproval({ req, text }: { req: ServerRequest; text: string }) {
  const v = phoneDataView(text)
  return (
    <>
      <div className="sheet-title">{v.ok ? '⚠ Let Hermux read your phone?' : '⚠ Unreadable phone data request'}</div>
      <div className="sheet-scroll">
        <div className="sheet-desc">
          {splitUntrusted(v.text).map((p, i) =>
            p.untrusted ? (
              // text that came from the request: its own element, plain text, visibly different from the app's words
              <code key={i} className="pd-untrusted" style={{ fontFamily: 'monospace', padding: '1px 6px', borderRadius: 4, background: 'color-mix(in srgb, currentColor 14%, transparent)', border: '1px solid color-mix(in srgb, currentColor 30%, transparent)' }}>
                {p.text}
              </code>
            ) : (
              <span key={i}>{p.text}</span>
            )
          )}
        </div>
        {v.ok ? <div className="sheet-desc">Only this once. What it reads goes into the chat and to your model provider.</div> : null}
      </div>
      <div className="sheet-actions col">
        {v.ok ? (
          <button
            className="btn primary"
            onClick={() => {
              haptic()
              answerRequest(req, { choice: 'once' })
            }}
          >
            Allow once
          </button>
        ) : null}
        <button
          className="btn danger"
          onClick={() => {
            haptic()
            answerRequest(req, { choice: 'deny' })
          }}
        >
          Deny
        </button>
      </div>
    </>
  )
}

function Approval({ req }: { req: ServerRequest }) {
  const p = req.params as Record<string, unknown>
  const phoneData = phoneDataTextOf(p)
  if (phoneData !== null) return <PhoneDataApproval req={req} text={phoneData} />
  const choices = ((p.choices as ApprovalChoice[] | undefined)?.length
    ? (p.choices as ApprovalChoice[])
    : (['once', p.allow_session !== false ? 'session' : null, p.allow_permanent ? 'always' : null, 'deny'].filter(Boolean) as ApprovalChoice[]))
  return (
    <>
      <div className="sheet-title">⚠ Approve {String(p.tool_name || 'command')}?</div>
      {/* A long warning or command scrolls; the answer buttons always stay on screen. */}
      <div className="sheet-scroll">
        {p.description ? <div className="sheet-desc"><Linked text={tidyApprovalText(String(p.description))} /></div> : null}
        {p.command ? <pre className="sheet-code"><Linked text={String(p.command)} /></pre> : null}
      </div>
      <div className="sheet-actions col">
        {choices.map(c => (
          <button
            key={c}
            className={c === 'deny' ? 'btn danger' : c === 'once' ? 'btn primary' : 'btn'}
            onClick={() => {
              haptic()
              answerRequest(req, { choice: c })
            }}
          >
            {CHOICE_LABEL[c] || c}
          </button>
        ))}
      </div>
    </>
  )
}

function OneQuestion({
  q,
  value,
  onChange,
  onPicked
}: {
  q: ClarifyQuestion
  value: string
  onChange: (v: string) => void
  onPicked?: () => void
}) {
  const selected = value ? value.split('\n') : []
  return (
    <div className="clarify-q">
      <div className="sheet-desc strong"><Linked text={q.question} /></div>
      {q.choices?.length ? (
        <div className="choice-list">
          {q.choices.map(c => {
            const on = selected.includes(c)
            return (
              <button
                key={c}
                className={`choice${on ? ' on' : ''}`}
                onClick={() => {
                  haptic()
                  if (q.multi_select) onChange((on ? selected.filter(x => x !== c) : [...selected, c]).join('\n'))
                  else {
                    onChange(c)
                    onPicked?.()
                  }
                }}
              >
                {q.multi_select ? (on ? '☑ ' : '☐ ') : on ? '● ' : '○ '}
                {c}
              </button>
            )
          })}
        </div>
      ) : null}
      <textarea
        className="sheet-input"
        rows={2}
        placeholder={q.choices?.length ? 'Or type your own answer…' : 'Your answer…'}
        value={q.choices?.includes(value) ? '' : value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

function Clarify({ req }: { req: ServerRequest }) {
  const p = req.params as Record<string, unknown>
  const questions: ClarifyQuestion[] = (p.questions as ClarifyQuestion[] | undefined)?.length
    ? (p.questions as ClarifyQuestion[])
    : [{ qid: '_', question: String(p.question || 'Hermux has a question'), choices: (p.choices as string[]) || null, multi_select: Boolean(p.multi_select) }]
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  const timer = useRef<number | undefined>(undefined)
  const n = questions.length
  const multi = n > 1
  const ready = questions.every(q => (answers[q.qid] || '').trim())
  const stopTimer = () => window.clearTimeout(timer.current)
  useEffect(() => stopTimer, [])
  const goTo = (i: number) => {
    stopTimer()
    haptic()
    setStep(Math.max(0, Math.min(n - 1, i)))
  }
  // Back (Android) steps to the previous question; on the first one the sheet registers nothing, as before.
  useBackHandler(() => goTo(step - 1), multi && step > 0)
  // After a single-choice pick, move on by itself; a second tap restarts the pause.
  const picked = () => {
    if (!multi || step >= n - 1) return
    stopTimer()
    const from = step
    timer.current = window.setTimeout(() => {
      haptic()
      setStep(nextStep(answersRef.current, questions, from))
    }, ADVANCE_MS)
  }
  const answersRef = useRef(answers)
  answersRef.current = answers
  const shown = multi ? [questions[step]] : questions
  const last = step >= n - 1
  return (
    <>
      <div className="sheet-title">❓ Hermux asks</div>
      {multi ? (
        <div className="clarify-steps">
          <span>
            Question {step + 1} of {n}
          </span>
          <span className="clarify-dots">
            {questions.map((q, k) => (
              <button
                key={q.qid}
                className={`clarify-dot${(answers[q.qid] || '').trim() ? ' done' : ''}${k === step ? ' on' : ''}`}
                aria-label={`Go to question ${k + 1}`}
                onClick={() => goTo(k)}
              />
            ))}
          </span>
        </div>
      ) : null}
      <div className="sheet-scroll">
        {shown.map(q => (
          <OneQuestion
            key={q.qid}
            q={q}
            value={answers[q.qid] || ''}
            onChange={v => {
              answersRef.current = { ...answersRef.current, [q.qid]: v }
              setAnswers(answersRef.current)
            }}
            onPicked={picked}
          />
        ))}
      </div>
      <div className="sheet-actions">
        <button className="btn" onClick={() => answerRequest(req, { answer: '' })}>
          Skip
        </button>
        {multi && step > 0 ? (
          <button className="btn" onClick={() => goTo(step - 1)}>
            Back
          </button>
        ) : null}
        {multi && !last ? (
          <button className="btn primary" onClick={() => goTo(step + 1)}>
            Next
          </button>
        ) : (
          <button
            className="btn primary"
            disabled={!ready}
            onClick={() => {
              haptic()
              if (p.questions && (p.questions as unknown[]).length) answerRequest(req, { answers })
              else answerRequest(req, { answer: answers['_'] })
            }}
          >
            Answer
          </button>
        )}
      </div>
    </>
  )
}

function MaskedValue({ req }: { req: ServerRequest }) {
  const p = req.params as Record<string, unknown>
  const [value, setValue] = useState('')
  const title =
    req.method === 'sudo' ? '🔐 Password needed' : req.method === 'secret' ? `🔑 ${String(p.env_var || 'Secret')}` : '🔢 Code needed'
  return (
    <>
      <div className="sheet-title">{title}</div>
      <div className="sheet-scroll">
        <div className="sheet-desc"><Linked text={String(p.prompt || p.command || p.message || 'Hermux needs a value to continue.')} /></div>
      </div>
      <input
        className="sheet-input"
        type={req.method === 'otp' ? 'text' : 'password'}
        inputMode={req.method === 'otp' ? 'numeric' : undefined}
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
      />
      <div className="sheet-actions">
        <button className="btn" onClick={() => rejectRequest(req)}>
          Cancel
        </button>
        <button className="btn primary" disabled={!value} onClick={() => answerRequest(req, { value })}>
          Send
        </button>
      </div>
    </>
  )
}

export function RequestSheet({ req }: { req: ServerRequest }) {
  return (
    <div className="sheet-backdrop">
      <div className="sheet" role="dialog">
        <div className="sheet-grip" />
        {req.method === 'approval' ? <Approval req={req} /> : req.method === 'clarify' ? <Clarify req={req} /> : <MaskedValue req={req} />}
      </div>
    </div>
  )
}
