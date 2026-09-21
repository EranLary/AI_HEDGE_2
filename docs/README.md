# Documentation index

Repository documentation is grouped by purpose so an operator or coding agent
can find the authoritative guide without scanning the project root.

## Architecture

- [Runtime pipeline](architecture/pipeline.md)
- [Data lifecycle and sources of truth](architecture/data-lifecycle.md)
- [Legacy-core dependency map](architecture/dependency-map.md)
- [HTML-first reports](architecture/html-first-reports.md)
- [Dependency diagram](architecture/diagrams/dependency-map.png)
- [Main valuation diagram](architecture/diagrams/valuation-main-map.png)

## Operations

- [Nasdaq 100 workspace](operations/nasdaq100-workspace.md)
- [IBKR Paper trading](operations/ibkr-paper-trading.md)
- [DNS setup](operations/dns-setup.md)

## Development

- [Validation guide](development/testing.md)

Keep current behavior and invariants in these guides. Historical investigation
notes and generated run artifacts do not belong in `docs/`.

Diagram sources live in `scripts/docs/`; generated images stay beside the
architecture they explain.
