import type { TourAction, TourMiss } from './contracts'

/**
 * The tour DRIVER: a ghost cursor that works on any screen. Scripts (./contracts.ts) are declarative;
 * this animates a fake cursor to REAL elements, fires real clicks (React handles them normally), and
 * types into real fields character by character with native setters, so controlled components update.
 *
 * Ported from the tourable-prototype template's `src/tour/driver.js`. What the port keeps, because it
 * is what makes a walkthrough watchable rather than a screen recording:
 *
 * - Clicks pause about half a second between the click animation and the actual click. There is no
 *   page-load delay to pace the viewer, so the driver supplies one.
 * - The cursor hides while typing (it would cover the text) and reappears on its next move.
 * - Cancellation is checked INSIDE actions, before every real click and every typed character, so
 *   Back or Exit mid-script can never let a stale click land on the next step's screen.
 * - `isDriving()` is true while a script runs. The engine uses it to tell driver-initiated navigation
 *   from the viewer's own (the derail guard) and to hide the cursor when the VIEWER scrolls.
 *
 * What the port CHANGES, and why:
 *
 * - **Selectors are awaited, not sampled.** The source queried the DOM immediately; here every action
 *   polls for its target up to a real-time deadline. A tour is also a CI walkthrough run at ~50x
 *   speed, where the app has not necessarily re-rendered by the time the next action starts.
 * - **A miss is recorded, not swallowed.** The source kept the tour alive by ignoring a missing
 *   element. This keeps the tour alive too (a viewer must never be stranded) but reports every
 *   unresolved target, which is how a screen change that breaks a tour fails the build.
 * - **`emit` is gone.** The source had a bridge to app-level actions; here the world has its own UI —
 *   the Simulator panel — so a tour drives it by clicking real controls (the `panel` action), which
 *   is both better to watch and the reason keel needs to learn no app vocabulary.
 * - **Speed is a value, not a window global.** `setDriverSpeed` is wired to the Tours tab's Fast
 *   switch, which is also how CI runs a tour in seconds.
 */

/** The ghost cursor's element ids — rendered by ./tour-overlay.tsx, moved from here. */
export const CURSOR_ID = 'keel-tour-cursor'
export const CURSOR_RING_ID = 'keel-tour-cursor-ring'

// Bumped by every cancelScript(); an in-flight script whose token is stale stops at its next check.
let token = 0
// Depth rather than a boolean: an `advance` script can start while an entry script is unwinding.
let driving = 0
// Fast-forward: finish the current script near-instantly instead of cancelling it (Next mid-script
// must never leave a form half-filled).
let fastForwarding = false
let speedScale = 1

/** Scale every delay. 1 = presentation pace; the Tours tab's Fast switch drops it to a preview
 *  crawl, which is also how the CI walkthrough runs a whole tour in a few seconds. */
export function setDriverSpeed(scale: number) {
    speedScale = scale
}

export function cancelScript() {
    token += 1
}

export function isDriving(): boolean {
    return driving > 0
}

/** Called when the viewer presses Next mid-script: the script completes instantly, then the tour moves
 *  on. Cancelling instead would strand a half-typed form on screen. */
export function requestFastForward() {
    if (driving > 0) fastForwarding = true
}

// Real-time deadlines (NOT scaled): how long an action waits for its target before calling it a miss.
// Interactive actions want a short leash; `expect`/`expectText` are deliberately "wait for the world to
// catch up" actions, so they wait for an autonomous actor or a job to land.
const FIND_TIMEOUT_MS = 2_500
const EXPECT_TIMEOUT_MS = 8_000
const POLL_MS = 60

const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(1, ms * (fastForwarding ? 0.01 : speedScale))))
/** A real-time wait, immune to the speed control — used only for polling the DOM. */
const realSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const query = (selector: string): HTMLElement | null => document.querySelector<HTMLElement>(selector)
const cursor = () => document.getElementById(CURSOR_ID)

interface ScriptContext {
    alive: () => boolean
    miss: (action: string, target: string) => void
}

/** Poll for a selector until the deadline. Returns null (and stays silent) — callers decide whether a
 *  missing element is a miss, because `panel` legitimately probes for an element that may not be there. */
async function waitFor(ctx: ScriptContext, selector: string, timeoutMs: number): Promise<HTMLElement | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
        const el = query(selector)
        if (el) return el
        if (!ctx.alive() || Date.now() > deadline) return null
        await realSleep(POLL_MS)
    }
}

/** Resolve a target an action REQUIRES: a failure is recorded as a miss and the action no-ops. */
async function resolve(ctx: ScriptContext, action: string, selector: string): Promise<HTMLElement | null> {
    const el = await waitFor(ctx, selector, FIND_TIMEOUT_MS)
    if (!el && ctx.alive()) ctx.miss(action, selector)
    return el
}

function place(el: Element) {
    const c = cursor()
    if (!c) return
    const rect = el.getBoundingClientRect()
    c.style.opacity = '1'
    // Aim at the element's middle, but never more than 140px in — on a full-width row the cursor
    // should sit where a hand would reach, not in the far distance.
    c.style.transform = `translate(${rect.left + Math.min(rect.width / 2, 140)}px, ${rect.top + rect.height / 2}px)`
}

function scrollIntoView(el: Element) {
    try {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } catch {
        // jsdom/happy-dom have no layout — the tour is still driveable without the scroll.
    }
}

/** Glide to an element: scroll it to the middle of the screen, then move the cursor onto it. */
async function moveTo(ctx: ScriptContext, action: string, selector: string): Promise<HTMLElement | null> {
    const el = await resolve(ctx, action, selector)
    if (!el || !ctx.alive()) return null
    scrollIntoView(el)
    await sleep(380)
    if (!ctx.alive()) return null
    place(el)
    await sleep(650)
    return ctx.alive() ? el : null
}

/** The click halo. Web Animations API rather than a stylesheet: keel components ship no global CSS. */
async function ripple() {
    const ring = document.getElementById(CURSOR_RING_ID)
    ring?.animate(
        [
            { opacity: 1, transform: 'scale(0.35)' },
            { opacity: 0.8, transform: 'scale(1.45)', offset: 0.55 },
            { opacity: 0, transform: 'scale(1.95)' },
        ],
        { duration: 700, easing: 'cubic-bezier(.15,.6,.25,1)' },
    )
    await sleep(380)
}

/** Set a value the way a user would, so React's onChange sees it: the native setter bypasses React's
 *  value tracker, which would otherwise swallow the input event as a no-op. */
function setNativeValue(el: HTMLElement, value: string) {
    const proto =
        el.tagName === 'SELECT'
            ? window.HTMLSelectElement
            : el.tagName === 'TEXTAREA'
              ? window.HTMLTextAreaElement
              : window.HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set
    if (setter) setter.call(el, value)
    else (el as HTMLInputElement).value = value
}

async function clickAction(ctx: ScriptContext, selector: string) {
    const el = await moveTo(ctx, 'click', selector)
    if (!el) return
    await ripple()
    await sleep(500) // let the viewer register the click before anything on screen changes
    if (!ctx.alive()) return // Back/Exit was pressed: this click must not land
    el.click()
    await sleep(720) // breathing room after the change
}

async function typeAction(ctx: ScriptContext, selector: string, text: string) {
    const el = await moveTo(ctx, 'type', selector)
    if (!el) return
    el.focus()
    const c = cursor()
    if (c) c.style.opacity = '0' // the cursor would cover the text being typed
    for (let i = 1; i <= text.length; i += 1) {
        if (!ctx.alive()) return
        setNativeValue(el, text.slice(0, i))
        el.dispatchEvent(new Event('input', { bubbles: true }))
        await sleep(26)
    }
    await sleep(240)
}

async function selectAction(ctx: ScriptContext, selector: string, value: string) {
    const el = await moveTo(ctx, 'select', selector)
    if (!el) return
    await ripple()
    if (!ctx.alive()) return
    setNativeValue(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(420)
}

/**
 * Drive the Simulator panel through its own controls. Expanding is conditional (the panel remembers
 * whether the viewer left it open), so this probes for the panel WITHOUT recording a miss — only the
 * tab itself is required.
 */
async function panelAction(ctx: ScriptContext, tab?: string) {
    const expanded = () => query('[data-testid="simulator-panel"]')
    if (tab === undefined) {
        if (expanded()) await clickAction(ctx, '[data-testid="simulator-collapse"]')
        return
    }
    if (!expanded()) {
        await clickAction(ctx, '[data-testid="simulator-pill"]')
        // The panel mounts on click; wait for it rather than racing the render.
        await waitFor(ctx, '[data-testid="simulator-panel"]', FIND_TIMEOUT_MS)
    }
    await clickAction(ctx, `[data-testid="simulator-tab-${tab}"]`)
}

async function expectAction(ctx: ScriptContext, selector: string) {
    const el = await waitFor(ctx, selector, EXPECT_TIMEOUT_MS)
    if (!el) {
        if (ctx.alive()) ctx.miss('expect', selector)
        return
    }
    scrollIntoView(el)
    await sleep(300)
}

async function expectTextAction(ctx: ScriptContext, selector: string, needle: string) {
    const deadline = Date.now() + EXPECT_TIMEOUT_MS
    for (;;) {
        const el = query(selector)
        if (el?.textContent?.includes(needle)) {
            scrollIntoView(el)
            await sleep(300)
            return
        }
        if (!ctx.alive()) return
        if (Date.now() > deadline) {
            ctx.miss('expectText', `${selector} — ${needle}`)
            return
        }
        await realSleep(POLL_MS)
    }
}

async function runAction(ctx: ScriptContext, action: TourAction) {
    switch (action[0]) {
        case 'move': {
            await moveTo(ctx, 'move', action[1])
            return
        }
        case 'click':
            return clickAction(ctx, action[1])
        case 'type':
            return typeAction(ctx, action[1], action[2])
        case 'select':
            return selectAction(ctx, action[1], action[2])
        case 'panel':
            return panelAction(ctx, action[1])
        case 'expect':
            return expectAction(ctx, action[1])
        case 'expectText':
            return expectTextAction(ctx, action[1], action[2])
        case 'scrollTo': {
            const el = await resolve(ctx, 'scrollTo', action[1])
            if (!el || !ctx.alive()) return
            scrollIntoView(el)
            await sleep(600)
            if (ctx.alive()) place(el)
            return
        }
        case 'scrollTop': {
            try {
                window.scrollTo({ top: 0, behavior: 'smooth' })
            } catch {
                window.scrollTo(0, 0)
            }
            await sleep(400)
            return
        }
        case 'pause':
            await sleep(action[1])
    }
}

/**
 * Run one script to completion. Never throws: a tour that dies mid-step strands the viewer, so an
 * action that blows up is reported through `onMiss` and the story carries on.
 */
export async function runScript(script: readonly TourAction[] | undefined, onMiss: (miss: TourMiss) => void) {
    if (!script || script.length === 0) {
        hideCursor()
        return
    }
    const mine = (token += 1)
    const ctx: ScriptContext = {
        alive: () => mine === token,
        miss: (action, target) => onMiss({ action, target }),
    }
    driving += 1
    try {
        await sleep(350) // let the step's screen render before the cursor arrives
        for (const action of script) {
            if (!ctx.alive()) return
            try {
                await runAction(ctx, action)
            } catch (error) {
                ctx.miss(action[0], `${String(action[1] ?? '')} (${error instanceof Error ? error.message : 'failed'})`)
            }
        }
    } finally {
        driving -= 1
        if (driving === 0) fastForwarding = false
    }
}

export function hideCursor() {
    const c = cursor()
    if (c) c.style.opacity = '0'
}
