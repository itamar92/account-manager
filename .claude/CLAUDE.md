# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

# Ad campaign advice (Meta ads for the band's shows)
- **adadvisor** skills (`.claude/skills/adadvisor*/`) - media-buyer playbooks for Meta (Facebook + Instagram) campaigns, adapted from https://github.com/AdAdvisor/skills (Apache-2.0). They do **not** use the adadvisor.ai MCP: they run on this app's own read-only Meta connection (the `account-manager` MCP: `band_campaigns`, `band_ad_analysis`, `band_shows`, `band_campaign_advice`).
When the user asks for advice about ad campaigns ("AI campaign", audit, diagnose, launch, scale, creative, targeting, show promotion, קמפיין, פרסום), ALWAYS load the `adadvisor` foundation skill first, then the matching workflow skill (`adadvisor-audit`, `-diagnose`, `-launch`, `-scale`, `-creative`, `-targeting`, `-playbooks`), and base the answer on them instead of generic advice.
- The `account-manager` connection is read-only and campaign-level: it cannot see ad sets, ads or conversions; missing data is requested, never guessed. Pixel status per club lives in the app («פיקסל ומעקב מכירות»).
- Actions: never change the ad account without first showing a preview (target read live, now → after, effect) and getting an explicit yes in the user's next message — one change per yes. Prefer the app's own flow (יועץ קמפיינים → תצוגה מקדימה → אישור); a write-capable Meta connector in the session follows the same protocol (`.claude/skills/adadvisor/references/mutation-safety.md`). Otherwise recommendations are instructions for Ads Manager.
- If the `account-manager` MCP tools are not in the tool list, say live campaign data is unavailable, give advice from the skill references only, and do not invent figures.

# Design skills (frontend / UI work)
- **impeccable** (`.claude/skills/impeccable/`) - design, critique, audit and polish any interface, including dashboards and app screens. From https://github.com/pbakaus/impeccable (Apache-2.0). Trigger: `/impeccable [command] [target]`
- **taste-skill** (`.claude/skills/taste-skill/`, skill name `design-taste-frontend`) - art direction for public-facing pages (landing, marketing, one-pagers); not for dashboards or app screens. From https://github.com/Leonxlnx/taste-skill (MIT).
- **apple-design** (`.claude/skills/apple-design/`) - Apple-style fluid motion, gestures, springs, materials and typography for the web. From https://github.com/emilkowalski/skills (MIT).
To refresh one, copy its folder again from the upstream repo; edit nothing inside so updates stay a plain copy.
