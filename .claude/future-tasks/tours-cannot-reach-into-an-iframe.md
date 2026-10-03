# Tours can't drive content inside an iframe

**Priority:** P2 · **Status:** open

The tour driver's own element lookup is `document.querySelector<HTMLElement>(selector)`
(`packages/keel/src/demo-static/tour/driver.ts:79`), scoped to the TOP-LEVEL document only. An
iframe — same-origin or not — has its own, separate `document`; the driver's `query()` cannot see
into one at all, so neither a `click` nor a `type` script action can ever reach an element that lives
inside an iframe the host page has embedded.

**Need:** a derived app that embeds something in an iframe — most obviously a code editor or another
third-party widget that only ships as an embeddable frame — and wants a tour to walk through using
it needs the driver able to target elements inside a _same-origin_ iframe (cross-origin is a real
browser restriction with no general fix; same-origin is not), at minimum via an explicit selector
form that names the frame (e.g. `{ frame: string; selector: string }`, resolved through
`iframe.contentDocument`).

This is a real, hit limitation, not a hypothetical: it is why a derived app with an iframe-hosted
editor left that surface out of its own tours rather than working around it in the driver.

Evidence: `packages/keel/src/demo-static/tour/driver.ts:79` (`query`, `document.querySelector` only),
`packages/keel/src/demo-static/tour/contracts.ts` (the `TourAction` shapes a frame-aware selector
would extend).
