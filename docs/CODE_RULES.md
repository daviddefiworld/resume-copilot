# Code Rules

Keep code clean, simple, stable, and easy to understand.

## Core Principles

- Use Object-Oriented Programming when it makes responsibilities clearer.
- Follow the Single Responsibility Principle strictly: each class, function, and module should have one clear reason to change.
- Follow KISS strictly: prefer the simplest working design over clever abstractions.
- Keep the number of files small so the codebase stays easy to understand.
- Keep code readable first: use clear names, direct control flow, and small focused methods.

## Quality Rules

- Be aware of performance before adding loops, database queries, network calls, or heavy client-side work.
- Be aware of stability before changing shared behavior, persistence, API contracts, or rendering paths.
- Avoid unnecessary layers, helpers, dependencies, and configuration.
- Prefer explicit, maintainable code over compact code that is hard to reason about.
- Add tests or verification when a change affects user-facing behavior, persistence, AI output handling, or export logic.
