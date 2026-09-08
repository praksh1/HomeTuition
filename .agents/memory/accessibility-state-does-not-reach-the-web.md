# `accessibilityState` does not reach the web

Found 8 September 2026, building the program studio.

## What is wrong

React Native's `accessibilityState={{ disabled: true }}` produces **nothing** in the browser.
React Native Web 0.21 reads the `aria-*` props instead, and ignores `accessibilityState`
entirely. The evidence is in the package itself — `react-native-web/dist/modules/createDOMProps`
takes `disabled` from `props['aria-disabled']` or `props.accessibilityDisabled`, and
`accessibilityState` is not in the list of props it forwards at all.

So a control written the normal React Native way is:

- correct on iOS and Android;
- on the web, drawn faded and announced to a screen reader as an ordinary, available button.

Faded is a *visual* convention. A blind user gets no signal at all. In the program studio it was
"Move step 1 up" at the top of a list — offered, read out as available, and doing nothing.

## What to write instead

Both spellings, on any control that has a state worth announcing:

```tsx
accessibilityState={{ disabled }}   // React Native reads this
aria-disabled={disabled}            // React Native Web reads this
```

`aria-disabled`, `aria-busy`, `aria-selected`, `aria-expanded` and `aria-checked` are all real
props on React Native 0.71+ (`Libraries/Components/View/ViewAccessibility.d.ts`), so this
typechecks and behaves on a phone too. Passing both is redundant on one platform and necessary
on the other, which is cheaper than remembering which is which.

## How much of the app this affects

Eighteen call sites across `components/` and `app/` still use `accessibilityState` alone —
`PaymentSheet`, `DailyEmbed`, `forgot-password`, `monthly-homework`, the student dashboard and
others. Only `components/programs/*` were corrected, because that was the task in hand. Every
other one is a control that on the web looks unavailable and announces itself as available.

## How it was caught, which is the transferable part

Not by reading the code. `scripts/program-studio/run.mjs` renders the real components in a real
browser and asserted `aria-disabled === "true"` on the first step's Move up button. A design
review would have passed it — the button *looks* disabled in the screenshot.

An accessibility claim that has only been eyeballed has not been checked.
