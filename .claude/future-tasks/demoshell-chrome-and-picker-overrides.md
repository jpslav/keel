# DemoShell should let an app override chrome and narrow the sign-in picker

**Priority:** P2 · **Status:** open

`DemoShellProps` (`packages/keel/src/demo-static/shell.tsx`) takes an app's `welcome`, `nav` and
`dashboard`, but the framework's own generic chrome (`AppHeader`) and the default sign-in picker
(built from every seeded person, with no way to narrow it) are both fixed. Two independent asks:

- **Chrome override.** An app that has already built its own, already-router-agnostic shell (its own
  header/sidebar composition) has no way to use it in place of the framework's generic chrome inside
  the demo — it either lives with the generic header or forks the demo shell entirely.
- **Narrower sign-in picker.** The default picker lists every person in the seeded world, including
  anyone outside the app's own intended audience for that picker (the full roster stays reachable
  through the Simulator panel's People tab regardless, so narrowing the picker loses no capability,
  only the default's breadth).

**Need:** two optional props, both no-ops when omitted so no existing consumer (including keel's own
reference app) changes behavior — a `chrome` prop wrapping the signed-in content so an app can
replace `AppHeader`, and a `signInPicker` prop replacing the default `PeoplePicker` with a narrower
one of the app's own choosing.

Evidence: `packages/keel/src/demo-static/shell.tsx` (today's `DemoShellProps`, fixed chrome and
picker).
