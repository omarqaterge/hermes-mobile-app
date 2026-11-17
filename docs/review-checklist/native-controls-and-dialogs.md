# A native form control or browser dialog

- paths: `^web/src/.*\.tsx?$`
- adds: `<select|<input[^>]*type=["'](range|checkbox|radio|date|time|color)|(^|[^.\w])(confirm|prompt|alert)\(`

Owner decisions `no-native-form-controls` and `no-browser-dialogs`: use `web/src/components/ui.tsx` and
`web/src/dialog.tsx`. Native controls look and behave differently per Android maker and ignore the theme.
