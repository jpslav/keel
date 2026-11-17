# Four framework controls fail "label in name" (axe 4.14), holding axe back

**Priority:** P1 · **Status:** open

axe-core 4.14.0 (2026-10-05) turned `label-content-name-mismatch` on by default. The rule checks WCAG
2.5.3 "Label in Name" (Level A): a control's accessible name must contain its visible text, so a voice
control user can say what they see. Four framework controls fail it. In each, an `aria-label` replaces
the visible text instead of containing it:

| Control (test id)    | Component                                                    | Visible text                                                     | Accessible name (en / es)                                                      |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `org-switcher`       | `packages/keel/src/components/auth/org-switcher.tsx`         | the active team's name                                           | `switchLabel`: "Switch team" / "Cambiar equipo"                                |
| `user-menu`          | `packages/keel/src/components/auth/user-menu.tsx`            | the avatar's initials                                            | `userMenuLabel`: "Account menu" / "Menú de la cuenta"                          |
| `simulator-pill`     | `packages/keel/src/components/simulator/simulator-panel.tsx` | `pillLabel` "Simulator", plus the unread badge when there is one | `pillAriaLabel`: "Open the Simulator panel" / "Abrir el panel Simulador"       |
| `simulator-collapse` | `packages/keel/src/components/simulator/simulator-panel.tsx` | `collapseButton` "Hide" / "Ocultar"                              | `collapseAriaLabel`: "Close the Simulator panel" / "Cerrar el panel Simulador" |

The strings live in keel's framework catalog, `packages/keel/src/i18n/messages/{en,es}.json`.

**Where it showed up.** The catch-up of October's Dependabot group (`deps/catch-up-2026-11`) took
`@axe-core/playwright` 4.14.0. 12 showcase e2e tests then failed on this one rule and no other: ten in
`a11y.spec.ts` (four admin pages, five Simulator tabs, the restricted dashboard) and both locales of
`smoke.spec.ts`. Only the showcase runs axe.
`@axe-core/playwright` is held at `~4.12.1`, which pins `axe-core ~4.12.1`, until this is fixed (see the
decision-log entry of 2026-11-16). Every Dependabot group that bumps it will fail the same way until then.

**Design to settle, then build.**

- Give each control an accessible name that starts with its visible text, in both locales. For example
  "Acme — switch team" for the switcher, or keep the visible text as the name and move the purpose to
  `aria-description`/`aria-describedby`. The initials-only avatar may be better as a name with the user's
  name in it than with the initials.
- No e2e locator matched these four names on 2026-11-16; the specs find the controls by test id. Re-check
  before renaming, since a role-name locator matches by substring.
- Run `/a11y-review` on the change, then lift the hold: set `@axe-core/playwright` back to a caret range
  in `apps/showcase/package.json` and confirm `a11y.spec.ts` and `smoke.spec.ts` are green.
