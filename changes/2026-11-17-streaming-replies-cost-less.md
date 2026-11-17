- **Long replies are lighter on the phone while they arrive.** While Hermux writes a long answer, the app used to
  read the whole answer as Markdown again and colour every code block again on each update, about 12 times a second.
  It now does that only for the newest part; what is finished is drawn once and left alone. Colouring code is also set
  up once instead of for every message drawn, which makes opening a chat with many messages a little quicker. Measured
  in a desktop browser with a reply streamed at a model's pace (`tools/web-e2e/streamcost.cjs`): the page's work for a
  2,000 / 8,000 / 16,000-character reply went from 1.12 / 4.97 / 9.61 s to 0.83 / 2.89 / 4.96 s. Not yet measured on a
  phone.
