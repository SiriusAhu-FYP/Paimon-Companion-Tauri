# Tauri Baseline

## Purpose

This document defines the baseline architecture of `paimon-companion-tauri` after the fork cleanup.

## Core Principle

The app itself is pure Tauri:

- Rust host for system-facing capabilities
- TypeScript for application logic
- React for interface and Live2D presentation

External AI services are still allowed and expected:

- vLLM
- GPT-SoVITS
- other OpenAI-compatible endpoints

## Boundary

### Rust owns

- system window discovery
- screen capture
- input injection
- secure secret access
- local OS integration
- HTTP / SSE proxy where browser constraints apply

### TypeScript owns

- orchestrator loop
- capability selection
- message assembly
- safety / verification policy
- runtime coordination
- character state and companion feedback
- reusable game task template definitions for finite action sets

## Functional Latency Policy

For the current functional-validation stages:

- the real-time game loop does not use knowledge retrieval
- embedding and rerank requests are kept out of the control path
- vision/game-task services call the configured model endpoint directly when needed

The knowledge module is still retained in the repo and runtime for:

- chat / companion experiments
- manual context injection
- future non-real-time workflows

Reason:

- the functional loop is latency-bound, and extra retrieval / rerank hops materially hurt action turnaround

## Reusable Game Tasks

For games with a small finite task set, the functional layer now supports reusable task templates.

This is intended for things like:

- menu toggles
- short movement probes
- simple interaction tasks

The pattern keeps:

- shared screenshot / window / verification helpers in common modules
- per-game task metadata and fallback action orderings in template definition files
- service classes focused on orchestration, event emission, and run summaries

Reference:

- see `docs/architecture/game-task-templates.md`

### React owns

- control layout
- stage output
- inspection tools
- user-triggered debug actions

## Why This Matters

This keeps the app free of an in-app Python sidecar while still allowing external model services to remain in Python where that is practical.
