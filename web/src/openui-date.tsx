// OpenUI's DatePicker, with one fix. It keeps a picked day as a JavaScript Date, and OpenUI's own "required" check
// (lang-core isEmpty) calls any object without own keys empty, so a Date (which has none) always failed with "This
// field is required" even though the day showed in the field. Here the day is kept as the text "YYYY-MM-DD" (a range
// as {from, to}), which also survives the saved form state (JSON) and reads well in the message the card sends.
// The calendar also closes once the day (or both ends of a range) is picked; OpenUI's stays open over the buttons below it
// until a tap lands outside.
// Same name, props and description as OpenUI's, so the reference text Hermes is taught does not change.
// Imported only by openui-entry.tsx (the lazy bundle).
import { useEffect, useMemo, useState } from 'react'
import { defineComponent, parseStructuredRules, useFormValidation, useIsStreaming, useStateField } from '@openuidev/react-lang'
import { DatePicker as UiDatePicker } from '@openuidev/react-ui'
import { library } from './openui-lib'
import { dayText, rangeText, textDay } from './openui-msg'

const base = library.components.DatePicker

export const DatePicker = defineComponent({
  name: 'DatePicker',
  props: base.props,
  description: base.description,
  component: ({ props }: { props: { name: string; mode?: 'single' | 'range'; rules?: unknown; value?: unknown } }) => {
    const [open, setOpen] = useState(false)
    const isStreaming = useIsStreaming()
    const formValidation = useFormValidation()
    const field = useStateField(props.name, props.value)
    const range = props.mode === 'range'
    const rules = useMemo(() => parseStructuredRules(props.rules), [props.rules])
    const hasRules = rules.length > 0
    useEffect(() => {
      if (!isStreaming && hasRules && formValidation) {
        // A range counts once both ends are picked.
        formValidation.registerField(field.name, rules, () => {
          const v = field.value as { from?: unknown; to?: unknown } | string | undefined
          return range ? (v && typeof v === 'object' && v.from && v.to ? v : undefined) : v
        })
        return () => formValidation.unregisterField(field.name)
      }
      return undefined
    }, [field.name, field.value, formValidation, hasRules, isStreaming, range, rules])
    const store = (v: unknown) => {
      const done = !range || !!(v as { to?: unknown } | undefined)?.to
      field.setValue(v)
      if (hasRules && done) formValidation?.validateField(field.name, v, rules)
      if (done) setOpen(false)
    }
    if (range) {
      const v = (field.value ?? {}) as { from?: unknown; to?: unknown }
      const sel = v.from || v.to ? { from: textDay(v.from), to: textDay(v.to) } : undefined
      return <UiDatePicker mode="range" isOpen={open} setIsOpen={setOpen} selectedRangeDates={sel} setSelectedRangeDates={(r?: { from?: Date; to?: Date }) => store(r ? rangeText(r) : undefined)} />
    }
    return <UiDatePicker mode="single" isOpen={open} setIsOpen={setOpen} selectedSingleDate={textDay(field.value)} setSelectedSingleDate={(d?: Date) => store(d ? dayText(d) : undefined)} />
  }
})
