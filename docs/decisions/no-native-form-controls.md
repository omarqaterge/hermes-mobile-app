# No native form controls

**Decided:** by the owner, with app 0.7.55.

`<select>` and `<input type=range|checkbox|radio|date|time>` show the system look on Android, which the owner rejected ("everything must match the app's visual language"). Use `SelectRow` / `PickerSheet`, `SliderRow`, `Toggle` / `ToggleRow` and `Segmented` from `web/src/components/ui.tsx`. Styled text fields and textareas are fine.

**So:** The one exception is OpenUI cards (`openui-cards-inline.md`).
