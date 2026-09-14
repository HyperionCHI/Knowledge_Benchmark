# Knowledge Workbench

[中文](README.md) | English

[![CI](https://github.com/HyperionCHI/Knowledge_Benchmark/actions/workflows/ci.yml/badge.svg)](https://github.com/HyperionCHI/Knowledge_Benchmark/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

![Knowledge Workbench — self-hosted knowledge management for teams](docs/assets/knowledge-workbench-hero.png)

Knowledge Workbench is a self-hosted, privacy-conscious knowledge management workspace for teams. It combines Markdown documents, brand and product SOPs, project links, attachments, terminology, reusable templates, and personal or organization-wide tasks in one interface.

This repository is a sanitized public release. It contains no production database, account, session, document, attachment, audit, customer, or business data. The first launch creates a new local database and guides you through creating the initial administrator.

## Highlights

- Markdown documents with Mermaid diagrams, tables, math, images, and attachments
- Hierarchical brand and product SOPs
- Document categories, ordering, lifecycle status, trash, and version history
- Attachment versions, reference checks, downloads, and cleanup
- Terminology and reusable template libraries
- Recurring personal tasks and administrator-assigned organization tasks
- Administrator, editor, and member access levels
- Local SQLite database and local attachment storage
- Consistent online backup and offline restore workflows

## Quick start

Requirements: Node.js 22.14 or newer (22.23.2 recommended) and pnpm 11.19.

```bash
git clone https://github.com/HyperionCHI/Knowledge_Benchmark.git
cd Knowledge_Benchmark
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3001`. On first launch, create the initial administrator account. Self-service registration is disabled after initialization.

For Windows PowerShell, replace the copy command with:

```powershell
Copy-Item .env.example .env
```

For production deployment, configuration, backup, security, testing, and licensing details, see the [Chinese project documentation](README.md#文档) and [deployment guide](docs/DEPLOYMENT.md).

## Technology

React 19, TypeScript, Vinext/Vite, Better Auth, SQLite, Drizzle ORM, Cherry Markdown, React Markdown, and Mermaid.

## License

Knowledge Workbench source code is licensed under the [Apache License 2.0](LICENSE). Third-party components remain under their respective licenses; see [third-party notices](THIRD_PARTY_NOTICES.md), [complete license texts](THIRD_PARTY_LICENSES.txt), and the [MPL source offer](MPL_SOURCE_OFFER.md).
