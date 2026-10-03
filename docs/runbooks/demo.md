# Demo runbook

The showcase is a **support desk**. Northwind Support runs one: a Frontline Desk that answers customers,
a Platform Team behind it, and a small Desk Operations org that holds the operator powers. Pinebrook
Desk is a second, entirely separate site on the same installation.

This runbook is the story you tell, not a list of buttons. Everything runs hermetically:
`pnpm install && pnpm dev`, no docker, no credentials, no network.

**If you are not in the room, don't send this file — send the demo.** `dist-demo/index.html` carries the
same story as a **tour**: **Simulator → Tours → A ticket, end to end → Start**. A ghost cursor drives the
real screens while a bar narrates; nothing is submitted until the watcher presses Next, so they set the
pace. It covers sections 2 to 5 below in sixteen steps and about five minutes. The tour is also run to
completion in CI (`pnpm e2e:demo-static`), so it cannot quietly stop being true.

## The story

### 1. You are walking into a shift already in progress

Open `http://localhost:3000` → `/en`, the public welcome page. (In a linked worktree the port is
derived per checkout — `pnpm dev` prints it, or ask `node scripts/print-port.mjs showcase`.) The dark **Simulator pill** sits
bottom-right; that is the simulated world's control panel, not part of the product. Open
**Simulator → People** and click **Dana Okoye** — clicking a person signs you in as them instantly,
no password. (The sign-in screen with the person picker is the "real" login UX if you want to show
that instead; sign out first from the user menu.)

The desk does **not** open empty. Dana lands on the Frontline queue mid-shift: five tickets, two of
them unclaimed, one — `NW-1028`, the wrong tax rate on an invoice — four days old. There is a
diagnostic bundle already uploaded and an analysis already filed beside it, an escalation waiting on
another team's decision, and an unread message in the outbox. That is the point of the seeded world:
a product demo should start inside a situation, not build one from nothing.

Say out loud what is on screen, because everything after this is a consequence of it.

The desk has history behind it too: click **Show older tickets** and six resolved tickets from earlier
in the week appear beneath the live five, then the button goes away. That is **keyset pagination**
(`packages/keel/src/db/keyset.ts`), not a hidden "show all" — the queue is read one page at a time
through an opaque cursor, so the list stays correct on a desk with a year of tickets on it, and stays
correct while other agents are opening new ones above you. It is also the piece of the "list kit" the
framework ships: the grid around it is deliberately a recipe (`docs/recipes/list-kit.md`), because a
table encodes no framework rule and a scoped, stable paged read does.

### 2. A ticket arrives by email

This is the thing a support desk actually is: a mailbox that becomes work.

**Simulator → Mail → the inbound composer.** Address it to `frontline+support@` (the composer offers
the teams and the registered handler slugs — `support` and `feedback` — from the app's own registry, so
a newly registered handler shows up without anyone being told twice). Send it **from Dana's address**,
subject "Label printer prints blank labels".

Reload the desk. There is a new ticket at the top of the queue, `NW-1042`, open and unassigned, its
subject the email's subject and its body the email's text with the quoted reply chain stripped. The
inbound row in Simulator says `handled`, and the audit trail carries both the intake event and the
ticket creation.

Now send the same message from `stranger@nowhere.test`. It is filed **unmatched** and no ticket is
opened — email authoring grants exactly what the UI grants, no more. Then try
`frontline+feedback@` instead: that one opens a ticket too, but already **resolved**, so it lands in
the record without ever entering the queue. One registry, two handlers, materially different outcomes.

### 3. The desk works the ticket

Hand `NW-1042` to **Sam Rivera** with the assignee picker. Two things happen that are worth pointing
at: the audit trail records `ticket.assigned` rather than a generic update, and Sam — not the team's
admins — is notified. **Simulator → People → Sam Rivera** and his bell has risen; **Mail** has his
copy. Assign a ticket to yourself and nobody is notified at all, which is the correct behaviour and
the reason the recipient rule is worth having.

Move a ticket to **Waiting** and back to **Open**; move one to **Resolved**. A ticket's lifecycle is
not one-way — a customer replies and it reopens — and the state machine's only job here is to refuse a
change that changes nothing.

Ask the assistant: **"What tickets are open?"** The answer **streams in** a chunk at a time, and
underneath it is a list of the tickets its tools actually read. The prose is replayed from a committed
fixture, so the same question always gets the same words; the tickets beside it come from a live query
against this team's queue. Ask **"Has anyone reported the scanner dropping out?"** and the second tool
runs instead — the search one, the one the model supplies an argument to.

### 4. The bundle goes to an outside analyzer

`NW-1039` — the nightly stock sync timing out — has a customer's diagnostic bundle on it. Upload
another if you like: choose **Diagnostic bundle** on the Attachments card and drop a file. Only bundles
get an **Analyze** button; ordinary attachments do not, because only bundles are worth an analyzer's
time.

Click **Analyze**. A job appears, queued.

**Simulator → Actors.** The **bundle analyzer** card is polling `/api/service/jobs` on its own — the
activity log shows every real HTTP call it makes — and within a few seconds it claims the job, produces
the result, and reports it completed, all over the genuine service API with a token it minted itself.
No button was clicked. The job's card picks up the completion and offers the analysis for download.

Flip **Simulator → Snapshots → Hold jobs** on first if you want to watch it happen slowly: the world then
holds every job at `queued` instead of finishing it inline, and the analyzer becomes the only thing
that moves it. Pause the card and press **Step** to walk one HTTP call at a time.

Switch to the **Platform Team** with the header team switcher and start a job there. The analyzer will
not touch it — different team, and the two counterparties' work pools are disjoint by construction.
The **partner desk** card picks it up instead and delivers a completion **webhook**
(`POST /api/webhooks/jobs` in its log). Same outcome, a different counterparty, a different integration
shape.

### 5. The desk escalates, and the decision leaves the building

Back on **Frontline** as Dana, the Escalations card already holds one: `NW-1039` handed to the Platform
Team, open, waiting. Switch teams to **Platform** — same Dana, who admins both — and the identical row
is now under "Escalations to my team", with **Accept** and **Reject** on it. Sign in as **Sam Rivera**,
a plain member of Platform: he sees the same escalation (it is two-sided, unlike a ticket) but has no
decide buttons, because only a team manager may decide.

Before deciding, register a webhook endpoint on the **Team** screen for `escalation.decided`. Then
accept the escalation.

**Simulator → Hooks** now shows a signed delivery: the envelope, the signature header, the attempt.
Use **Make this endpoint fail** and decide another one to watch the retry schedule back off and
eventually land in `dead`. A decision is a fact other systems are entitled to hear about, and this is
how they hear about it.

### 6. The boundaries are real

- **Team boundary.** As Dana on Frontline, note the queue. Switch to Platform: a different queue, not a
  filtered one. Teams are a collaboration boundary inside one site — an app-level filter on the active
  org, not row-level security.
- **Site boundary.** **Simulator → People → Gale Bennett**, whose home site is Pinebrook Desk. The whole
  app re-themes, and Northwind's tickets, escalations and attachments are simply gone. Pinebrook has
  its own queue with its own reference series (`PB-207`). That is row-level security, not an
  if-statement. There is no site switcher in the product, on purpose: crossing sites means becoming
  someone whose home site differs.
- **Reduced access.** **People → Riley Chen**, a restricted member: she can read Pinebrook's queue and
  cannot change it, the assistant card is not offered, and the server refuses the same actions the UI
  hides — the same pure ability model decides both.
- **Operator powers.** **People → Olive Nakamura**, admin of the Desk Operations org. Acting AS that org
  grants manage-all _within_ Northwind, and never across the site boundary.

### 7. Tours: the same story, driving itself

**Simulator → Tours** lists the walkthroughs this app registers (`apps/showcase/src/app-config/tours.ts`).
**A ticket, end to end** restores the seeded world and then drives sections 2 to 5 with a ghost cursor:
it opens the panel, signs in as Dana from the People, types the customer's email into the inbound composer,
hands the resulting ticket to Sam, holds the world's jobs, sends the bundle to the analyzer, registers a
webhook on the Platform Team, accepts the escalation, and opens the signed delivery. A second tour,
**Joining the desk, from a preset** (§8), starts from the Mid-demo preset instead of the seed.

Use it when you cannot be in the room, or as a preview: **Fast** collapses the reading pauses. Pressing
Next is what submits anything, so you can stop on any step and poke at the product; wander off the story
and the bar offers you the way back. When it ends it says whether every element it drove was still there.

### 8. Snapshots: the knobs, and putting it back

**Simulator → Snapshots** carries four feature flags. Two are the framework's (**Demo banner**, **Hold
jobs**); two are the app's own. **Flag late tickets** makes the queue grow a banner and per-row badges
for anything past the desk's 48-hour SLA, so it changes the product, not the panel. **Hold the actors**
pauses every Simulator actor at once.

Also here: **Save a snapshot** before you experiment, and **Reset world** (two-step confirm) to put
everything back — including the seeded queue, which comes back exactly as it started.

**Start from a preset** is the demo-prep shortcut: one click resets the world, replays a scripted
starting point, and signs you in as the right person.

- **Fresh desk:** the seed, with Dana already signed in.
- **Mid-demo:** two new tickets, the refund one already assigned to Sam (who gets the assignment
  notification), and a teammate, Jordan, whose invite is waiting unread. The second tour, **Joining the
  desk, from a preset**, walks that invite to the end.
- **Both sites busy:** builds on Mid-demo (the same two tickets, Sam's assignment and Jordan's invite).
  It adds a Platform ticket and a pending Platform invite; gives Pinebrook two more tickets on top of
  its seeded one, plus a refused email from a restricted member; turns late-ticket highlighting on; and
  holds the **Partner desk** actor, whose Actors-tab card reads _Held_ while the Bundle analyzer keeps
  running. You're signed in at Pinebrook.

Presets are scripts, not saved files, so they load the same world in `dist-demo/index.html`. The one
visible difference is that the invite email shows in the language you are viewing the demo in, where
the server uses the inviter's.

Loading one signs in only YOUR browser. Anyone else watching the same server keeps who they were,
unless they were signed in as someone the reset removed (a person created by accepting an invite), in
which case they land on sign-in.

## Extras worth showing, if there is time

- **Invite someone.** **Team → Invite** `bob@example.com`. The invite email is caught by the fake mail
  store. You are looking at _Dana's_ inbox, so it is empty — either hit **Everyone's mail** or, better,
  **People → Bob's invited row**, which switches the _viewpoint_ (not a sign-in — Bob has no account
  yet). Open the invite; the buttons and links inside the preview work, and the **Copy** button next to
  each link lets you paste the accept link into a second browser profile to tour Bob on "his own
  machine". Accepting takes one name field, and People then shows him as a full person.
- **Scheduled work.** **Simulator → Jobs** lists three seeded schedules, one of each shape the
  scheduler supports: the desk's weekly queue review, its nightly SLA export, and the Platform Team's
  six-hourly handover digest. Advance the world clock past one and it fires, landing a real email in
  the Mail tab.
- **The access gate.** Northwind's Terms of Service are pre-accepted by everyone, so nothing blocks;
  bump the version in Snapshots and the whole tenant is gated until each person accepts. Northwind's
  support-data policy is _advisory_ — a banner, not a wall. Pinebrook's privacy notice shows the same
  advisory shape on the other site.
- **Everything it did.** **Simulator → Events** interleaves analytics events with the audit trail.
  Delete a ticket and note that the `ticket.deleted` audit event outlives the row it describes.

## Gotchas

- **Demo on the host you invited from.** `localhost` and `127.0.0.1` are different origins and
  different cookie hosts: switch mid-demo and you'll look signed-out, and accept links minted on the
  other host won't open (Simulator says why in the notice strip rather than doing nothing).
- **"Mine" vs "Everyone's mail"** is the most common stumble: an invite never lands in the _inviter's_
  inbox.
- **Invites are one per address** — inviting an existing member or re-inviting the same address is
  rejected, with the reason on the form. Reset the world to reuse `bob@example.com`.
- **Turn Hold jobs back off** when you're done with the Actors tab; jobs complete inline by default.
- **Snapshots wipes `.data/`** — snapshots survive resets, but accounts created mid-demo, mail, and any
  tickets you opened go back to the seed. That is the point.
- **The assistant's prose never changes**, whatever the queue looks like. That is deliberate: the
  composing pass always replays a committed fixture so a walkthrough is never surprised, while the
  tickets listed beneath the answer come from a live read. Say so before someone notices.

## The static single-file demo

`pnpm build:demo-static` → `apps/showcase/dist-demo/index.html` walks the same story from a file on
disk, with no server at all. It opens on the same seeded queue, the same open escalation, the same
attachments; the Actors tab runs the same two counterparty cards inline over in-memory state, activity
log included; and a world reset restores the seeded desk rather than emptying it.

What degrades, and only where physics forbid otherwise:

- **No bytes anywhere.** Uploads keep the file's name, size and kind (the browser File API works from
  `file://`), but nothing stores the bytes, so there is no download link — the same reason an export
  completes with no CSV to fetch and an analysis completes with no document.
- **The assistant's composing pass** is replayed locally rather than streamed from a server. It emits
  the same text in chunks, and the tools still run live against the in-memory queue, so the sources
  list is real.
- **Snapshots is reset-and-presets only** — there is no `.data/` to save a snapshot into, but the demo
  presets are scripts the in-memory world replays, so they (and the tour that starts from one) work here.
