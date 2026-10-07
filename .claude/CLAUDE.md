# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

# Ad campaign advice (Meta ads for the band's shows)
- **adadvisor** skills (`.claude/skills/adadvisor*/`) - media-buyer playbooks for Meta (Facebook + Instagram) campaigns, adapted from https://github.com/AdAdvisor/skills (Apache-2.0). They do **not** use the adadvisor.ai MCP: they run on this app's own read-only Meta connection (the `account-manager` MCP: `band_campaigns`, `band_ad_analysis`, `band_shows`, `band_campaign_advice`).
When the user asks for advice about ad campaigns ("AI campaign", audit, diagnose, launch, scale, creative, targeting, show promotion, קמפיין, פרסום), ALWAYS load the `adadvisor` foundation skill first, then the matching workflow skill (`adadvisor-audit`, `-diagnose`, `-launch`, `-scale`, `-creative`, `-targeting`, `-playbooks`), and base the answer on them instead of generic advice.
- The connection is read-only and campaign-level: you cannot change the ad account, and you cannot see ad sets, ads, conversions or the pixel. Recommendations are instructions for the user to carry out in Ads Manager; missing data is requested, never guessed.
- If the `account-manager` MCP tools are not in the tool list, say live campaign data is unavailable, give advice from the skill references only, and do not invent figures.
