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

### React owns

- control layout
- stage output
- inspection tools
- user-triggered debug actions

## Why This Matters

This keeps the app free of an in-app Python sidecar while still allowing external model services to remain in Python where that is practical.
