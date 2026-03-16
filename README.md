# SiteNerve

SiteNerve is an AI-powered technical SEO monitoring platform for teams that want continuous visibility into how their websites are crawled, structured, and improved over time.

Instead of running a one-off audit, SiteNerve stores crawl history, tracks issue lifecycles, extracts page-level SEO signals, builds an internal-link graph, and lets Gemini-powered agents generate findings and recommendations after crawls.

## What It Does

SiteNerve helps users:

- create and manage website monitoring projects
- crawl a site from its root URL and optional sitemap
- detect technical SEO issues across pages
- compare crawl results over time
- visualize site structure and internal linking
- extract and score page keywords
- run AI agents against project data and crawl results
- receive notifications and webhook events when important things happen

## Main Product Areas

### Projects and Crawls

Users create a project with a site URL, optional sitemap URL, and crawl settings. A new project can trigger an initial crawl automatically. Crawl runs store page snapshots, diagnostics, diff data, logs, and aggregate counts such as new pages, removed pages, changed pages, and errors.

### Technical SEO Auditing

After crawling, SiteNerve evaluates pages against a broad set of SEO rules across categories such as:

- crawlability
- indexability
- on-page SEO
- canonicalization
- links
- images
- structured data
- security
- internationalization
- mobile
- social
- performance

Issues are stored with severity, evidence, lifecycle state, and whitelist support so teams can distinguish real work from accepted exceptions.

### Site Graph and Content Relationships

The app builds a graph of pages and links so users can explore:

- internal linking structure
- orphan or weakly connected pages
- segment and group relationships
- bridge pages
- content similarity and cannibalization signals
- link opportunities

### Keyword Extraction

SiteNerve extracts keywords from crawled pages and stores per-page keyword scores so users can inspect topical coverage and export keyword data.

### AI Agents

Projects include Gemini-backed agents that can run after crawls or manually. Agents analyze project context, return structured findings, and generate remediation ideas. Agent runs and findings are stored historically so users can review what happened over time.

### Notifications and Webhooks

The app supports in-product notifications and project-level webhook delivery so downstream systems can be informed about events like crawl completion and agent activity.

## User-Facing Pages

The current app includes:

- auth pages: `login`, `register`, `verify-email`
- dashboard home
- projects list
- project overview
- project issues
- project graph
- project keywords
- project agents
- individual agent detail and run history
- project notifications
- project settings
- global notifications
- account settings
- AI settings
- webhook settings

## API Surface

The application exposes routes for:

- authentication and registration
- project CRUD
- crawl start and cancel flows
- issues listing, updates, and export
- graph data
- page data
- keyword data
- agent CRUD and agent execution
- qualification runs
- user AI settings and key verification
- notifications
- whitelist management
- project webhook configuration, test delivery, and delivery history

## Architecture

SiteNerve is a Next.js monolith with a separate worker process for asynchronous jobs.

### Application Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Tailwind CSS v4
- Prisma with PostgreSQL
- NextAuth v5 with Prisma adapter
- BullMQ with Redis
- Crawlee `CheerioCrawler`
- Google Gemini via `@google/generative-ai`
- Recharts and React Force Graph for visualization
- Monaco Editor for agent prompt editing

### Data Model Highlights

The Prisma schema includes first-class models for:

- users and sessions
- projects
- pages
- crawls
- issues
- whitelist entries
- agents, agent runs, and agent findings
- qualification runs
- notifications
- webhook deliveries
- graph nodes and graph edges
- page keywords

## Background Workers

Long-running and async processing is handled by queue workers in `src/workers`.

Current worker responsibilities include:

- crawl execution
- post-crawl processing
- audit generation
- keyword extraction
- AI agent execution
- notification generation
- webhook delivery
- qualification summary generation

The worker entrypoint is `src/workers/start-all.ts`.

## Infrastructure Requirements

To run SiteNerve locally, you need:

- PostgreSQL
- Redis
- Node.js 20+

The repository includes:

- `Dockerfile` for the web app, migration job, and worker image
- `docker-compose.yml` for local orchestration of Postgres, Redis, migrations, app, and worker

## Environment Variables

The app expects a few core environment variables:

- `DATABASE_URL`
- `REDIS_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `AUTH_SECRET`
- `ENCRYPTION_KEY`

Optional OAuth variables:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

Optional crawler tuning:

- `CRAWLER_MEMORY_MBYTES`

Notes:

- `ENCRYPTION_KEY` should be a 64-character hex string
- Gemini API keys are configured per user inside the app rather than as a single global server env var

## Running The App

### Option 1: Docker Compose

This is the easiest way to run the full stack locally.

```bash
docker compose up --build
```

This starts:

- PostgreSQL
- Redis
- a one-off migration container
- the Next.js app
- the background worker process

The app will be available at [http://localhost:3000](http://localhost:3000).

### Option 2: Run Services Manually

1. Install dependencies:

```bash
npm install --legacy-peer-deps
```

2. Make sure PostgreSQL and Redis are running.

3. Set the required environment variables.

4. Generate the Prisma client:

```bash
npx prisma generate
```

5. Apply database migrations:

```bash
npx prisma migrate deploy
```

6. Start the web app:

```bash
npm run dev
```

7. In a second terminal, start workers:

```bash
npx tsx src/workers/start-all.ts
```

## Available Scripts

- `npm run dev` starts the Next.js dev server
- `npm run build` creates the production build
- `npm run start` runs the production server
- `npm run lint` runs ESLint

## Current Caveats

A few parts of the codebase still look in progress:

- some settings page API integrations are referenced but not yet implemented
- some webhook event wiring appears partial
- scheduled crawl or scheduled agent execution is represented in the schema and UI, but a dedicated scheduler process is not obvious in the current codebase

## Who This Is For

SiteNerve is aimed at:

- SEO teams
- technical marketers
- agencies managing multiple client sites
- product and engineering teams responsible for site health

It is especially useful when you want continuous technical SEO monitoring instead of periodic manual audits.
