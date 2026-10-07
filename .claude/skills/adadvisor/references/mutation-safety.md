## Mutation safety — idempotency, guardrails, and the audit trail

Every AdAdvisor mutation hits Meta's Marketing API live. There is no staging, no dry-run, no rollback. This reference is the safety surface: what's idempotent, what's not, how partial failures surface, and how to read the audit-trail fields on every mutation response.

## Idempotency by tool

| Tool | Idempotent? | Safe to retry on timeout? |
|---|---|---|
| `adadvisor:change_entity_status` | Yes | Yes — re-applying `resume` on an already-resumed entity is a no-op |
| `adadvisor:change_entity_budget` | Yes | Yes — re-applying the same value succeeds with no Meta side effects |
| `adadvisor:update_entity` | Yes (per-field) | Yes — the same field set with the same values is a no-op |
| `adadvisor:update_adset_targeting` | Yes | Yes — Meta accepts identical targeting payloads idempotently |
| `adadvisor:create_campaign` | **NO** | **NO** — each call creates a new campaign with a new `id` |
| `adadvisor:create_adset` | **NO** | **NO** — each call creates a new ad set |
| `adadvisor:create_ad` | **NO** | **NO** |
| `adadvisor:create_creative` | **NO** | **NO** |
| `adadvisor:create_lead_form` | **NO** | **NO** |
| `adadvisor:duplicate_campaign` | **NO** | **NO** — duplicates compound |
| `adadvisor:duplicate_adset` | **NO** | **NO** |
| `adadvisor:duplicate_ad` | **NO** | **NO** |
| `adadvisor:create_website_audience` | **NO** | **NO** |
| `adadvisor:create_lookalike_audience` | **NO** | **NO** |
| `adadvisor:upload_ad_image` / `upload_ad_video` | Effectively yes (Meta dedupes by hash) | Yes — same bytes return same `image_hash` |

**Rule: never retry a non-idempotent tool without first inspecting the response.** If the call timed out or errored ambiguously, list the parent entity (`list_campaigns`, `list_adsets`, `list_ads`) and check whether the new entity already exists. Retrying blindly will leave you with two campaigns named "ADADVISOR || CBO || TOF || Cold || Acme || 2026-05-12" and the user will lose trust the moment they see Ads Manager.

## The 2× / 0.5× budget guardrail

`adadvisor:change_entity_budget` rejects any change where the new budget is greater than **2.0× the current value** or less than **0.5× the current value**. This is a local guardrail in the MCP, not a Meta limit.

Why: rapid budget changes reset Meta's learning phase. A budget that 3× overnight tells Meta "different campaign, start optimizing again." Foxwell's published cadence is **20% increments every 2-3 days** for scaling winners; Common Thread Collective's BFCM playbook stages at **30% per day max**. The 2× / 0.5× ceiling is intentionally permissive of those workflows while blocking the catastrophic mistake (typo, agent confusion, drunk Friday afternoon).

When you legitimately need a bigger move:

```
# Stage it
adadvisor:change_entity_budget(entity_id=..., daily_budget=current * 1.5)
# wait 24-48h
adadvisor:change_entity_budget(entity_id=..., daily_budget=stage1 * 1.5)
```

Or override:

```
adadvisor:change_entity_budget(entity_id=..., daily_budget=current * 3.0, force=True)
```

`force=True` requires the user has explicitly authorized the jump in the conversation. **Don't pass `force=True` to silence an error you don't understand** — read the response, confirm it's not a different validation issue, then escalate to the user with the specific tradeoff (learning reset, expected CPA inflation for 3-7 days).

## Partial-failure handling on batched tools

The batched create tools (`create_campaign`, `create_adset`, `create_ad`, `create_creative`, `create_lead_form`) accept an array of specs and return a response with a top-level `status` field:

| `status` | Meaning |
|---|---|
| `"success"` | All entities created. `entities[]` has the full list. `errors[]` is empty / absent. |
| `"partial"` | Some entities created, some failed. `entities[]` has the successes; `errors[]` has per-spec failure reasons. |
| `"failed"` | No entities created. `errors[]` has the reasons; `entities[]` is empty. |

A `partial` response is the dangerous one. The successful entities are **real** — they exist in Meta, they will spend if activated. Before retrying the failed specs, you must:

1. List the `entities[]` array and confirm which inputs already succeeded. Don't re-submit those.
2. Read each `errors[i]` — the failure reason may be a fixable input issue (invalid targeting ID, missing `conversion_domain`, ineligible placement) or a systemic problem (token expired, Meta API outage).
3. Retry only the failed specs, with fixes applied.

Example response shape:

```json
{
  "status": "partial",
  "entities": [
    {"id": "120217...", "name": "ADADVISOR || CBO || TOF || Cold || 2026-05-12", "status": "PAUSED"}
  ],
  "errors": [
    {
      "index": 1,
      "spec": {...},
      "code": 2490408,
      "message": "conversion_domain is required for OUTCOME_SALES campaigns",
      "retry_safe": true
    }
  ],
  "update_id": "upd_01H..."
}
```

If `retry_safe: true` is set on an error, the failure happened before Meta state changed — that spec can be safely re-submitted after fixing the input. If `retry_safe: false` (rare — only when Meta returned an ambiguous timeout), do not retry; list the parent and verify state.

## The `update_id` audit-trail field

Every mutation response carries a top-level `update_id` (format `upd_01H...`, ULID). It uniquely identifies the mutation in AdAdvisor's audit log, persisted server-side. When the user asks "what did you change?" or "roll that back," you reference `update_id` and the audit log can show the full before/after diff.

When you batch a series of changes (pause five campaigns, raise two budgets, create three ad sets), surface the `update_id`s in your summary:

> "Done. Paused `WSO || Cold || US` (upd_01HX...), `WSO || Cold || CA` (upd_01HY...). Raised budget on `WSO || RET || US` from $200 to $260 (upd_01HZ...). New ad set in `ADADVISOR || CBO || TOF` is paused at $50/day (upd_01HA...)."

The user doesn't typically need to read the IDs, but their presence in your summary signals "this was logged, reversible if needed." Future agents reading the conversation transcript can grep for them.

## `state_before` / `state_after`

Every mutation response includes the canonical state of the affected entity before and after the change. For idempotent ops this confirms what *actually* changed (e.g. the resume call succeeded but the status went from `PAUSED` to `ACTIVE` only on success — if both are `PAUSED`, Meta rejected silently for a reason worth checking, often a billing or policy hold).

```json
{
  "update_id": "upd_01H...",
  "state_before": {"status": "PAUSED", "daily_budget": 100.0, "name": "..."},
  "state_after":  {"status": "ACTIVE", "daily_budget": 100.0, "name": "..."},
  "next_steps": [
    "Ad set is now active. Verify spend appears in `get_timeseries` within 1-2 hours.",
    "Parent campaign status is ACTIVE — no further activation needed."
  ]
}
```

When you report back to the user, **prefer `state_after` over your assumed state.** If you intended to raise the budget to $200 and `state_after.daily_budget` is $150, Meta rounded or applied a constraint — say so. Don't paraphrase your input as truth.

## Activation does not cascade

Resuming a campaign does **not** resume its child ad sets. Resuming an ad set does **not** resume its child ads. Each level must be activated separately, leaf-first:

```
adadvisor:change_entity_status(entity_type='ad',     entity_ids=[ad_id],     action='resume')
adadvisor:change_entity_status(entity_type='adset',  entity_ids=[adset_id],  action='resume')
adadvisor:change_entity_status(entity_type='campaign', entity_ids=[campaign_id], action='resume')
```

Why leaf-first: activating a parent while children are paused does nothing bad. Activating a parent while you intend children to be paused does nothing wrong. The fail mode is the reverse — activating an ad set under a paused campaign and reporting "ad set is live" to the user, when Meta is silently not delivering because the campaign gate is closed.

Always check `state_after.status` at every level. The MCP's `next_steps` strings will list the exact additional calls when activation is incomplete.

## What `next_steps` strings are for

Every mutation response includes a `next_steps: string[]` field. These are human-readable hints the MCP generates based on the mutation context — they tell you what to do next:

- After `create_campaign`: typically lists the activation chain (ad → ad set → campaign) and reminds about budget review.
- After `change_entity_budget` (large jump): may flag learning-reset risk and suggest a 48-hour observation window before further changes.
- After `update_adset_targeting`: lists the targeting fields changed and warns that targeting changes also reset learning.
- After `create_lookalike_audience`: notes the ~24-hour build time before the audience is usable.

**Read them every time.** They surface non-obvious downstream consequences the MCP knows about that the agent might miss. Paraphrase the important ones in your user summary; ignore the trivial ones.

## When to escalate to the user

Surface to the user before mutating when:

- The change is non-idempotent and the cost of duplication is real (new campaign, new audience).
- The budget change is >50% in either direction, even if under the 2× ceiling — learning-reset risk.
- The mutation affects an ACTIVE entity currently spending — pausing or budget changes should be confirmed unless the user gave explicit batch authorization.
- The mutation is a `force=True` override of a guardrail.
- Any mutation on production accounts with monthly spend > $50K — these are accounts where mistakes have material P&L impact; confirm twice.

For pure read tools, no escalation needed — they're side-effect-free.

See [`mcp-tool-cheatsheet.md`](mcp-tool-cheatsheet.md) for the mutation tool list; see [`economics.md`](economics.md) for the kill / scale thresholds that should drive *what* you mutate.
