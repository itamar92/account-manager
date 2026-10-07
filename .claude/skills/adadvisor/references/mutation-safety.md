# Read-only rules — and how to hand over an action

Upstream's `mutation-safety.md` covers idempotency, a 2× budget guardrail and batch partial failures of write tools. **This connection has no write tools**, so none of that applies.

## What is guaranteed

- The token is a System User token with scope **`ads_read`**. Meta itself refuses writes with it.
- The app's MCP server (`app/server/mcpTools.ts`) is read-only by design: "a tool that is not in that file does not exist."
- Nothing you say changes anything. A human acts in Ads Manager.

So: **never claim an action was taken**, never offer to "go ahead and do it", never ask for a broader token, never call the Graph API yourself.

## Writing an instruction the user can follow cold

Every recommendation that implies a change gets an action line. Format:

> **Ads Manager → Campaigns → *<exact name>* → <level> → <setting>: change <from> to <to>.** *Why:* one sentence. *Check after:* what to look at and when.

Rules:

1. **Name the entity exactly** as `moonlight_campaigns` returns it (and the level: campaign / ad set / ad). If you only know the campaign, say "the ad set inside it that…" and ask.
2. **One setting per line**, with from → to values and units (₪/day vs ₪ total).
3. **Order matters.** Leaf-up for activation (ad → ad set → campaign); pause top-down. Say so.
4. **New things start paused.** Say "create it paused and switch it on when the checks are done."
5. **State the decision rule, not just the action.** "Pause if cost per ticket is still above ₪X after 3 more days" is something the user can apply without you.
6. **Budget changes: step, don't jump.** Keep the stepping rule from `adadvisor-scale` — small raises, spaced out — except where the runway is under a week (see `economics.md`).
7. **Flag the irreversible ones.** Deleting a campaign loses its history; pausing does not. Prefer pause.
8. **Say what you could not check.** If a recommendation depends on something outside campaign-level data (frequency by ad set, pixel health), say so in the same line.

## Confirm intent before a large recommendation

A recommendation that moves real money — pausing the biggest campaign, doubling a budget, launching a new one — should name the assumption it rests on (the show date, the fee type, the data's freshness) so the user can correct the premise before acting. This replaces upstream's "confirm before every mutation": the human is the only actor, so the confirmation is built into the hand-over.

## After the user acts

Data only reaches you after the app's next Meta sync. Do not look for a change the same minute: tell the user to run the sync in the app (or wait for the next one) and name the date you will look at. Judge the effect on the daily curve (`moonlight_campaigns` with `campaign_id`), starting from the day of the change.
