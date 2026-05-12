# Architecture

This document describes how `paimon-companion-tauri` is organized as a system.

The goal is not to list every service or walk through every file. The goal is to make the structure of the project legible: what the main parts are, what each part is responsible for, and how the whole runtime holds together.

## 1. Overall Shape

At a high level, this project is a Tauri desktop host built around one shared runtime with two different ways of operating:

- a companion path for observation, response, speech, and Live2D presentation
- a delegation path for bounded task execution through tools and verification

These two paths are not separate applications. They share the same UI shell, the same TypeScript runtime foundation, the same Rust host boundary, and many of the same support systems. What changes between them is the execution policy and the kind of work the runtime is trying to do.

That shared shape is the most important thing to keep in mind when reading the repository.

## 2. Main Layers

The system is easiest to understand as four layers.

### UI Layer

The UI layer lives in `src/` and presents the runtime to the user.

It includes:

- the main application window
- the separate Stage window
- docked workspace panels for interaction and inspection

This layer is not only a presentation shell. It is also where the project exposes several inspection surfaces that matter to understanding runtime behavior:

- `Workbench`
- `Delegation Timeline`
- `Event Log`

These surfaces are part of the system shape because they make delegation traces, runtime state, and evidence artifacts visible.

### Runtime Layer

The TypeScript runtime also lives in `src/`. This is the main coordination layer of the system.

Its job is to hold together:

- mode control
- companion behavior
- delegation behavior
- semantic game/task logic
- prompt/config loading
- memory and evidence coordination
- UI-facing state updates

This layer is not structured as one global state container. It is a service-oriented runtime with an event bus used to connect long-lived subsystems.

### Host Layer

The host layer lives in `src-tauri/`.

This layer is responsible for the desktop boundary:

- window discovery, focus, and capture
- keyboard/mouse input dispatch
- local helper/runtime commands
- log and debug-capture lifecycle commands
- MCP-facing bridge commands

This is what makes the project a desktop operator rather than only a frontend that calls models.

### Support Material

The repository also contains tracked and local support material around the runtime:

- `prompts/` for shared prompt templates and retained wording artifacts
- `.workbench/` and `.private/` for local harnesses, experiments, logs, and machine-specific support material

These surfaces matter for development and experimentation, but they are not the center of the main runtime architecture.

## 3. Two Operating Paths

The runtime is easiest to reason about by following its two main operating paths.

### Companion Path

The companion path is the continuous observation-and-response side of the system.

In this path, the runtime takes in user input and runtime context, produces a response, speaks that response, and keeps the companion presentation state coherent across text, speech, and Live2D expression.

What matters architecturally is not every helper involved, but the fact that this path is designed around continuity:

- continuous observation
- response generation
- speech playback
- expression and speaking state
- proactive follow-up

This path is not trying to complete a bounded external task. It is trying to maintain a believable companion loop.

### Delegation Path

The delegation path is the bounded execution side of the system.

In this path, the runtime shifts from conversation into explicit task handling:

- check whether execution is allowed
- identify and focus the target
- reason through a structured delegation loop
- execute actions through the host/tool boundary
- verify what happened
- record the result for timeline, memory, and follow-up narration

The accepted delegation chain is a three-role structure:

- `Mission Analyst`
- `Operations Planner`
- `Progress Evaluator`

What matters here is that the runtime moves from open-ended response generation into a loop that is tool-using, stateful, and verification-driven.

## 4. Semantic Task Layer

The semantic task layer sits between high-level delegation reasoning and low-level desktop input.

Its role is to keep the runtime working in terms of tasks, routes, and semantic actions instead of dropping immediately to raw key presses or ad hoc window control.

In the current repository, the retained validation games are `2048` and `Sokoban`, with logic under `src/services/games/` and profile/config support from:

- `src/config/games/2048.toml`
- `src/config/games/sokoban.toml`

`Sokoban` is especially important because it exercises the harder parts of the system:

- multi-round planning
- route continuity
- verification
- correction after failure

So this layer is not just "game support." It is one of the places where the architecture shows whether the runtime can carry structured task state over multiple rounds.

## 5. Host And MCP Boundary

The host boundary is one of the defining architectural boundaries of this project.

The runtime does not act on the desktop directly from ordinary frontend code. It reaches operating-system-facing capabilities through the Tauri host layer and MCP-facing bridge commands.

That boundary exposes capabilities such as:

- window commands
- input dispatch
- companion control commands
- semantic game actions
- local ASR support
- debug/evidence lifecycle commands

This separation matters because it keeps orchestration logic and desktop action distinct. The TypeScript runtime decides what should happen; the host boundary is where those decisions become real operations on windows, tools, and local helpers.

## 6. Memory And Evidence

Memory and evidence are part of the main architecture, not just support utilities.

This layer includes:

- rolling context for recent runtime understanding
- file-backed long-term memory
- memory log promotion and writeback
- debug capture and exportable evidence artifacts
- delegation scratchpad mirroring

Architecturally, this layer does two jobs:

1. it lets the runtime carry bounded continuity across turns and tasks
2. it makes runtime behavior explainable after the fact through traces, captures, and exported artifacts

This is why memory and evidence belong in the system description. They are part of how the runtime is meant to operate, not only part of how it is debugged.

## 7. Mainline And Local Surfaces

Not every surface around this repository carries the same architectural weight.

The main runtime architecture lives in:

- `src/`
- `src-tauri/`
- `prompts/`

Around that mainline, there may also be branch-local or machine-local material such as:

- `.workbench/`
- `.private/`
- local logs
- local evaluation assets
- local sidecar setup scripts

These are real working surfaces around the project, but they should be read as support material unless a tracked document explicitly brings them into scope.
