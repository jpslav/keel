# Simulator abilities inspector

**Priority:** P2 · **Status:** open

A Simulator tab (or a People widget) answering "what can person X do" — run `defineAbilitiesFor` over every
`{action, subject}` pair and render allow/deny, so an ability-table change is visible without hand-testing
each person through the UI.

Parity-twinned like the rest of Simulator (the static shell already imports `defineAbilitiesFor` for the
dashboard card gate, so the twin is cheap).

**Why it isn't built:** the authorization retrofit only needed one visible denial to prove the choke point.
Build this when a second ability-gated surface makes eyeballing people one by one tedious.

The staff-org override (a real `manageAll` signal, active in the staff org) is now the thing this inspector
would make visible across every subject at a glance, rather than just one person's dashboard working.
Same threshold still applies.
