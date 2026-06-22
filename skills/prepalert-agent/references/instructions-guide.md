# Instructions Guide

Guidelines for the `instructions` field in `prepalert.yaml`.
Use as a guideline, not a rigid template. Pick and choose based on the project.

## What to Include

Write instructions based on: "What does the Agent need to know upfront to investigate alerts efficiently?"

### 1. One-line App Summary

A single sentence so the Agent immediately understands what app the alert is about.

Examples:
- `Web API on ECS. Depends on PostgreSQL + Redis.`
- `Node.js service on Lambda + API Gateway. Depends on DynamoDB.`
- `Next.js app on GKE. Connects to Cloud SQL (PostgreSQL).`
- `Python worker on Kubernetes. Depends on RabbitMQ + MySQL.`

### 2. Investigation Language

What language the Agent should use for investigation results.

### 3. External Dependencies (optional)

Information for the Agent to assess blast radius. Can be omitted if obvious from the codebase.
If included, write identifiers needed when using MCP tools (service names, log destinations, etc.).

### 4. Project-specific Investigation Hints (optional)

Operational knowledge not derivable from the codebase. Examples:

- Reference instructions for documents in specific directories
- Log destination explanations when non-obvious
- Service/role names in the monitoring service

## Writing Principles

- Don't write information derivable from the codebase. The Agent can look it up with Read/Grep
- Prioritize "operational information not written in code" needed for MCP tool usage
- Keep it concise. The Agent's context window is finite
