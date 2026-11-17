# A colour written out

- paths: `^web/src/.*\.(tsx?|css)$`
- adds: `^(?!\s*--)[^/]*(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()`

Colours come from CSS variables, because there is a light theme (decision `light-theme-colours`). A colour written
out in a component or a rule looks right in one theme only: look at the change in both.
