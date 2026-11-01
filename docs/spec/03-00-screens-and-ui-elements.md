## 3. Screens and UI elements

Every screen, sheet and panel of the page, in the order a user meets them: the navigation map first, then
the chat and everything drawn on it, then the drawer, the Hermes hub, Settings and the setup screens. Each
screen has a block with where it opens from, how it closes, its source, a table of its elements and the
data it reads and writes. The page is one React tree in the WebView (2.1); nothing here is drawn natively.
