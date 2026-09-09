# DOM presence is not visible or tappable

Two Phase 2B tests originally passed while concealing real phone failures:

- the teacher-page journey counted `focused-session-{id}` in the DOM, although the chosen class
  could remain far below the phone viewport;
- the Classes search used `element.click()` because the visible Search button overlapped the
  clear control at 390 px. A synthetic DOM event bypasses hit testing, so it proved the handler
  existed while proving nothing about a finger reaching it.

For a control reached through a public-card hand-off, verify its bounding box intersects the
viewport after navigation. For touch interactions, use the browser driver's coordinate-based
`click()`/`tap()`; never replace it with `evaluate(el => el.click())` to make an overlap pass.
If a test needs the bypass, the layout is the defect.

