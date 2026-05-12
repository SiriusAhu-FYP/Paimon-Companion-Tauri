# Architecture

This repository is a Tauri-first FYP codebase centered on a companion runtime, delegation workflows, and semantic game validation.

## Main Layers

- `src/`
  - React UI
  - runtime services
  - companion, delegation, and inspection surfaces
- `src-tauri/`
  - Rust host backend
  - native commands and MCP-facing bridge code
- `prompts/`
  - shared prompt templates and task wording
- `.workbench/`
  - branch-local harnesses, experiments, and machine-specific artifacts

## Research And Verification Surfaces

The repository intentionally keeps inspection-oriented surfaces visible:

- `Workbench`
- `Timeline`
- `Event Log`

These are part of the system's verification story and are used to inspect delegation, runtime state, and evidence trails.

## Scope Notes

- mainline scope is defined by `README.md` and `ROADMAP.md`
- experimental or local harness material may exist, but it is not the primary review surface
- this document is the only current `docs/` entry point
