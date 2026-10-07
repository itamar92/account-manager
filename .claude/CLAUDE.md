# graphify
- **graphify** (`.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

# AdAdvisor (AI / Meta ad campaigns)
- **adadvisor** skills (`.claude/skills/adadvisor*/`) - senior media buyer playbooks for Meta (Facebook + Instagram) ad campaigns, vendored from https://github.com/AdAdvisor/skills (Apache-2.0, v0.1.0).
When the user asks for advice about ad campaigns (audit, diagnose, launch, scale, creative, targeting, BFCM/lead-gen playbooks), ALWAYS load the `adadvisor` foundation skill first, then the matching workflow skill (`adadvisor-audit`, `adadvisor-diagnose`, `adadvisor-launch`, `adadvisor-scale`, `adadvisor-creative`, `adadvisor-targeting`, `adadvisor-playbooks`), and base the answer on them instead of generic advice.
These skills call `adadvisor:*` MCP tools; if the AdAdvisor MCP server is not connected, still give advice from the skill references and say live account data was not available.
