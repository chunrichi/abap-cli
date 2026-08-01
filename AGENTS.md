# AGENTS.md — AI Agent Project Guidelines

## Project Overview

abap-cli is a CLI tool for agent-driven ABAP development. It enables AI coding agents to develop ABAP code by reading/writing local files and communicating with SAP systems via ADT REST API and custom ICF services.

## Architecture

Three layers, each with its own directory:

- **CLI** (`src/abap_cli/`): TypeScript. Thin client. All commands support `--json` output.
- **SAP** (`abap/`): ABAP. ICF service handlers for DDIC CRUD.
- **Agent** (`skills/` + `agents/`): Markdown. Skill and workflow prompts.

## Key Conventions

- Source objects (Class, Interface, Program, CDS): ADT REST API via `abap-adt-api`
- DDIC objects (Domain, DataElement, Table): Self-built ICF service via RESTful JSON
- File format follows abap-file-format / abapGit conventions
- Credentials in `.env` (gitignored), config in `.abap.json` (gitignored)
- Environment variables override `.abap.json` values

## When Working on This Project

- Never commit `.env` or `.abap.json` files
- All new CLI commands must be registered in `src/abap_cli/index.ts`
- Follow the existing command pattern: `export function register<Name>Command(program: Command)`
- ABAP code in `abap/src/` follows abapGit file naming conventions
