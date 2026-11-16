# Pictures in OpenUI cards wait for a tap, in every chat

**Decided:** 2026-11-16, by the owner.

Web pictures in replies already wait for a tap in every chat (2026-11-15, see
[phone-data-read-only](phone-data-read-only.md)), because a prompt injection can write a picture address that carries out
what the agent has read. Cards were the gap: their pictures loaded with no tap unless the chat had read phone data, and a
card can join a `Query` answer into a picture's address.

Options weighed: hold them with a tap per card, drop web pictures from cards altogether, or leave them. The owner chose
the tap.

**So:**

- A card draws without its web pictures and shows "Images from the web are held back (sites)" with **Load images**, which
  loads them for that card only. The hold works on the card's evaluated props (`web/src/openui-hold.ts`), not on the
  source text, so an address built from pieces is held too.
- In a chat that has read phone data they stay held with no tap, as before.
- Don't make a card's pictures load by themselves again without asking the owner.
