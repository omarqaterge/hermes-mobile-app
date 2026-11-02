---
rank: small
---
- **Cards: a date picked in a card form is accepted.** A card with a required date field always said "This field is
  required" even though the day showed in the field, so the form never sent. It now accepts the day and sends it in
  the message as `- day: 2026-10-15` (a range as `from to to`). The calendar now closes once you pick the day, instead
  of staying open over the buttons. A list picker, text fields, checkboxes, radio buttons and chips were tried in the
  same form and were fine. Also fixed: a field the card tied to a `$variable` was left out of the message the button
  sent; it is now listed with the others. Browser tests with real clicks and taps; not yet on a real phone.
