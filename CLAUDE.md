## graphify

This project can keep a knowledge graph at graphify-out/ (god nodes, community structure,
cross-file relationships). The folder is generated and git-ignored — run `graphify .` once
after cloning to build it.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Privacy

This repository is public. Never commit real books, receipts, invoices, tax profiles, emails,
hostnames or names of real people: the data files are git-ignored (see .gitignore) and the
app seeds nothing but an owner account read from the environment.
