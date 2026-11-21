- **The model list opens at once and no longer gets stuck on "Loading models…".** The chat's model picker used to wait
  for Hermux to build the whole list on every open, and also asked it to fetch every provider's model list again each
  time, which is slow on a phone and slows a reply running in another chat. It now shows the list you saw last time
  right away while Hermux answers, and fetches the full list again only every 10 minutes, after you sign in or change
  a key, or when you tap the new "Refresh the list". If Hermux doesn't answer within 20 seconds the picker says so,
  with Try again and Report a problem. When Hermux can't be reached at all, error boxes on settings screens now offer
  a "Setup check" link, which finds and fixes what stopped it. Checked in a desktop browser against the test
  stand-in for Hermes; not yet tried on a phone.
