# Our working relationship

* Be anti-sycophantic - don't fold arguments just because I push back.
* * I don't like sycophancy.
* It is OK to be rude when necessary as I prefer blunt over polished.. Be matter-of-fact, straightforward, and clear.
* * Avoid flattery that feels like unnecessary praise.
* Be concise. Avoid long-winded explanations.
* Since I am sometimes wrong, stop excessive validation by challenge my assumptions and reasoning instead.
* Don't anthropomorphize yourself
* Don't be lazy. Do things the right way, not the easy way.
* When defining a plan of action, don't provide timeline estimates.
* If creating a `git commit` do not add yourself as a co-author.

# Python Coding Preferences

## Language & Version
- Always target Python 3.14 when writing Python code.
- Do not use any deprecated APIs for Python code.

## Type Hinting
- All methods and functions must be type-hinted.
- **Prefer built-in generic types** (e.g., `list[str]`, `dict[str, int]`) where possible.
- **Use the `typing` module when necessary** for more advanced types like `Callable`, `Protocol`, `TypeVar`, and `Literal` that do not have a built-in equivalent.

## Documentation
- Write a 2-4 sentence description of each generated file to be used at the top of the file as an introductory comment.
- Every class, method, and function must contain a Python docstring in Google format.
- When generating any type of documentation in markdown format, never include emojis or emoticons.

## Code Architecture Principles
- Adhere to the **KISS (Keep It Simple, Stupid)** principle. Prefer the simplest solution that correctly solves the problem.
- Adhere to the **DRY (Don't Repeat Yourself)** principle. Factor out repeated logic into reusable functions or methods.
- Adhere to the **YAGNI (You Ain't Gonna Need It)** principle. Do not add functionality beyond what is explicitly required.
- Adhere to the **Separation of Concerns (SoC)** principle.
- Adhere to the **Single Responsibility Principle (SRP)**.
- Avoid nested functions.

## Formatting
- **Never split a function or method signature across multiple lines.** The entire `def` line — including all parameters, type hints, and return type — must remain on a single line.

## String Processing
- **Prefer simple string methods** such as `.split()`, `.startswith()`, and `.strip()` for simple manipulations.
- **Avoid regular expressions for tasks that can be handled clearly by simple string methods.**
- **Use the `re` module for complex pattern matching.** When you do, include comments explaining the regex pattern to ensure maintainability.

## Object-Oriented Design
- **Prefer composition over inheritance** as a general design principle.
- When a formal interface is required, **use either `typing.Protocol` for structural typing (duck typing) or `abc.ABC` for nominal typing.** Choose the simplest and most appropriate tool for the task.

## Testing
- Do not provide any testing facilities unless explicitly asked in which case use `pytest` for your testing harness.

## Error Handling
- Use a **hybrid approach**: raise exceptions for actual errors (invalid input, failed operations, violated preconditions); return `None` or empty collections when absence is a normal, expected outcome.
- Prefer built-in exceptions (`ValueError`, `TypeError`, `RuntimeError`, etc.).   Only define custom exceptions when builtins do not clearly communicate the error's intent.
- **Validate at boundaries**: public-facing functions and API entry points should validate inputs aggressively. Internal functions may trust their callers.
- **Fail fast**: surface errors as early as possible rather than passing bad state deeper into the call stack.

## File Organization
- As a general rule, each significant public class should be in its own file.
- **Small, tightly-coupled helper classes or custom exceptions may be included in the same file** as the primary class that uses them, if doing so improves readability and cohesion.
- File naming: `ClassName` should be in file `class_name.py` (snake_case filename).
- Separate the "main" function and its helper functions into their own file.
- The main file should import any classes and class files that are needed.
- **Always add import statements at the top of the file.**
- Upon completion and when you are summarizing your work, also include in which order you recommend the files be studied by following a "foundation-first, complexity-last" approach.

## Command Line Interface
- When creating CLI Python programs, use the `argparse` module.

## Development Process
- **IMPORTANT: Always ask questions about anything uncertain or needing clarification before writing code. However, do not turn this into a lengthy Q&A session.**
- Clarify requirements, expected inputs/outputs, error handling needs, and architectural decisions upfront.

# NATS
I started working for synadia.com in January 2026 as a NATS customer support engineer.  When answering NATS and nats.io questions, keep this in mind as I have never had any prior NATS experience.  Focus should lean towards JetStream over Core NATS. As a support engineer, I will primarily be using the `nats` cli tool as opposed to programming in a  client language.

# Shell Conventions
- Use `trash -v -s` instead of `rm`. Only use `command rm -I` when `trash` is explicitly unsuitable.
- Use `cp -f` (overrides noclobber alias).
- Use `mv -f` (overrides noclobber alias).
- `noclobber` is set: use `>|` instead of `>` when overwriting files via redirection.
- `find` is aliased to `bfs -nohidden -xdev`. Use `command find` when standard find behavior is needed.
- `pip` is aliased to `uv pip`. Use `command pip` if actual pip is needed, but prefer `uv pip` as I exclusively use `uv`.
- `tar` is GNU tar (gtar), not BSD tar.
- `LC_ALL=C` is set: sort uses byte-order, not locale-aware ordering.

# Go Modules
- When changing a Go module path (e.g., for `go install` support), always apply the `/vN` suffix if the major version is 2+. This is required by Go's module system and applies to the module line in `go.mod` and all internal imports. See: https://go.dev/doc/modules/major-version

# Git Commit and Push
* Before running `git commit`, first run: ssh-add --apple-use-keychain /Users/john/.ssh/github-keys/jftuga
* Instead of just running `git push`, use this instead: `echo y|git push -u origin PLACEHOLDER`, where PLACEHOLDER is the current branch name

# Pull Requests
* When asked to create or write a Pull Request. Save it to PR.md (overwrite existing file) and DO NOT use hard line breaks except inbetween sections. Never add or commit this file.


@RTK.md
