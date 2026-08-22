# Tab labels are not the words you can see

A browser test read the tab bar with `textContent.trim()` and asserted
`"Dashboard".startsWith("Dashboard")`. It was false.

The label's text really begins with two private-use codepoints — U+F184 twice — because the
Feather icon is a glyph from an icon font, rendered as text inside the same element. They are
invisible in a terminal, and `JSON.stringify` prints them as-is, so the debug output showed
`["Dashboard","Sessions",...]` while every comparison failed. Only printing the code points
found it.

Strip them before comparing:

```js
n.textContent.replace(/[\uE000-\uF8FF]/g, "").trim()
```

The trap is not the failure — it is the near miss. A substring check (`/dashboard/i.test(t)`)
passes straight through this and looks like it is testing something exact. Two assertions in
that suite were passing for that reason before the strip went in.

Seen in `artifacts/sikshya/scripts/nav-tests/run.mjs`, 2026-08-22.
