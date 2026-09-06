# Project Instructions

This repository is `mdx-vocabulary`, a local-first MDX dictionary application.

The current architecture is:

```text
MDX
→ Importer / Worker
→ MdxParserAdapter / js-mdict
→ PostgreSQL / Prisma
→ DictionaryQueryService
→ Fastify REST API
→ Vite / React
→ Browser
```

Future production deployment is expected to use:

```text
Browser
→ Nginx
  ├── /        → Vite dist
  ├── /api/*   → Fastify
  └── /docs/*  → Fastify Swagger
→ PostgreSQL
```
## 0. Execution and Approval Policy

For routine development work inside this repository, proceed autonomously without asking for confirmation for ordinary implementation details.

This includes:

- Reading and modifying files inside this repository
- Creating normal project files
- Modifying the Prisma schema
- Creating additive, non-destructive migrations
- Running Prisma generate and normal migrations
- Running TypeScript type checks
- Running tests
- Running frontend builds
- Starting local Fastify and Vite services for verification
- Updating Swagger / OpenAPI documentation
- Updating README when required by the repository guidelines

Stop and ask for explicit approval before performing actions involving:

- Data loss
- Database resets
- Dropping tables or destructive migrations
- Deleting or overwriting important existing data
- Modifying files outside this repository
- Credentials, secrets, or external services
- git push or force push
- Publishing packages
- Production deployment
- Other high-risk or irreversible operations

The local PostgreSQL database may contain imported dictionary data that is expensive to recreate.

Never reset the database automatically. If Prisma reports schema drift, requires a reset, or warns that a migration may cause data loss, stop and ask for approval before proceeding.


Follow the rules below when modifying this repository.

## 1. Preserve module boundaries

Keep responsibilities separated.

* `src/importer/` owns MDX import orchestration and persistence flow.
* `src/mdx/` owns MDX parser abstractions and parser-specific implementation.
* `src/jobs/` owns import job queue/state behavior.
* `src/storage/` owns imported MDX file storage.
* `src/entries/` owns entry normalization, redirect parsing, HTML sanitization, and plain-text extraction.
* `src/query/` owns dictionary read/query business logic.
* `src/http/` owns Fastify HTTP transport, validation, error responses, and OpenAPI schemas.
* `web/` owns browser UI behavior.

Do not move business logic into Fastify route handlers or React components when it belongs in an existing service/module.

Do not modify importer, worker, storage, or MDX parser code unless the requested feature actually requires changes to the import pipeline.

## 2. Backend API conventions

The backend uses Fastify.

For new or changed public APIs:

* Define request validation using Fastify route schemas where practical.
* Keep response DTOs explicit.
* Update Swagger / OpenAPI schemas together with the API.
* Preserve the existing error response format:

```json
{
  "error": {
    "code": "...",
    "message": "..."
  }
}
```

* Do not expose internal Prisma objects directly.
* Do not expose `entryRaw`.
* Do not leak stack traces, Prisma errors, filesystem paths, or internal implementation details in HTTP 500 responses.
* Prefer putting reusable business logic into a service rather than directly into the route handler.

When adding or changing a public API, add or update integration tests.

## 3. Database conventions

The project uses PostgreSQL and Prisma.

When changing persistent data models:

* Modify `prisma/schema.prisma`.
* Create an appropriate Prisma migration.
* Preserve existing imported dictionary data unless destructive changes are explicitly requested.
* Prefer database constraints for invariants that must always hold, such as uniqueness.
* Use relations where they represent real domain relationships.
* Avoid unnecessary denormalization unless there is a clear reason.

Do not reset or recreate the development database unless explicitly requested.

Never run tests against a production database.

## 4. Dictionary entry rules

MDX dictionaries may contain duplicate headwords.

Do not introduce uniqueness assumptions based only on headword text.

Existing query behavior should remain consistent unless explicitly changed:

* exact search uses normalized headword equality.
* prefix search uses normalized prefix matching.
* dictionary scope is required.
* redirects are resolved at most one hop by the backend.
* duplicate dictionary entries may legitimately appear in results.
* public read APIs use sanitized HTML and plain text, not raw MDX HTML.

## 5. Frontend conventions

The frontend uses Vite + React + TypeScript.

Keep the frontend lightweight.

Prefer:

* React state
* native `fetch`
* small reusable components when they become useful
* ordinary CSS

Do not introduce Redux, Zustand, React Query, Axios, Tailwind, UI component libraries, or another major frontend framework unless the feature genuinely requires it or the user explicitly asks for it.

Frontend API requests must use relative paths:

```ts
fetch('/api/...')
```

Do not hardcode the Fastify host or port in frontend source code.

Development routing is handled by the Vite proxy.

Future production routing is expected to be handled by Nginx.

Do not duplicate backend business logic in the frontend, especially redirect resolution or dictionary normalization behavior.

## 6. Scope discipline

Implement the smallest complete version of the requested feature.

Do not proactively add unrelated infrastructure or features.

In particular, do not introduce these unless the current task needs them:

* authentication
* Redis
* Elasticsearch
* message brokers
* Docker
* Kubernetes
* complex caching
* complex state management
* large UI frameworks
* background services
* generic abstraction layers

Prefer a simple implementation that fits the current project size.

Avoid speculative abstractions for hypothetical future requirements.

## 7. Testing and validation

For backend changes, normally run:

```bash
npx tsc --noEmit
npm test
```

For frontend changes, normally run:

```bash
cd web
npm run build
```

When a feature changes observable application behavior, perform an appropriate manual end-to-end verification when practical.

Examples:

```text
Browser
→ Vite
→ Fastify
→ PostgreSQL
```

or:

```text
MDX
→ Importer
→ Worker
→ PostgreSQL
```

Do not claim manual verification unless it was actually performed.

Tests should clean up temporary data they create.

## 8. README maintenance

`README.md` describes the current usable system, not the development history.

After making changes, inspect whether README needs updating.

Update README when changes materially affect:

* architecture
* major modules
* public APIs
* core user-facing features
* setup instructions
* environment variables
* database preparation
* import workflow
* startup commands
* testing workflow
* deployment architecture

Do not update README for trivial refactors, formatting-only changes, or small bug fixes that do not change how the project is understood or used.

Do not describe planned functionality as already implemented.

## 9. Swagger / OpenAPI maintenance

Swagger is part of the backend contract.

Whenever public API routes, parameters, request bodies, responses, or error behaviors change:

* update the Fastify/OpenAPI schemas
* verify the generated OpenAPI document
* keep `/docs/` usable

Do not maintain a separate manually written API specification that can drift from the actual Fastify routes unless explicitly requested.

## 10. Dependency discipline

Before adding a new dependency, first check whether the task can be implemented cleanly with the existing stack.

Add dependencies only when they provide clear value.

Do not replace existing technologies merely because another library is more popular.

When adding a substantial dependency, briefly explain why it is needed.

Do not automatically run destructive dependency upgrade commands such as:

```bash
npm audit fix --force
```

## 11. Development workflow

Before changing code:

1. Inspect the relevant existing implementation.
2. Reuse existing services and conventions where possible.
3. Identify the smallest set of files that need to change.

After changing code:

1. Run relevant type checks and tests.
2. Perform manual verification when the feature warrants it.
3. Check whether Swagger needs updating.
4. Check whether README needs updating.
5. Report the files changed, behavior added, verification performed, and remaining relevant technical debt.

Do not continue into the next product feature after completing the requested scope unless explicitly asked.
