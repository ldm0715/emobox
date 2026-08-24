# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the React + TypeScript UI.
- `src/app/` defines the desktop shell, toolbar, sidebar, theme menu, and settings dialog.
- `src/features/` groups import, library-grid, and quick-search features. Keep feature-specific hooks beside their components.
- `src/lib/tauri.ts` is the frontend boundary for Tauri commands; shared contracts live in `src/types.ts`.
- `src-tauri/src/` contains Rust commands, recursive scanning, and thumbnail generation. Isolate future Windows-only code under `src-tauri/src/platform/windows/`.
- `src-tauri/icons/` contains generated application assets. Documentation lives in `README.md`, `MANUAL_ACCEPTANCE.md`, and `docs/`.

## Build, Test, and Development Commands

```powershell
npm install
npm run tauri dev
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

`npm run tauri dev` launches the Windows desktop app. `npm run build` performs TypeScript checking and a production Vite build. The Cargo commands format, compile, test, and lint the Rust backend.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript and let `cargo fmt` format Rust. Name React components and files with PascalCase (`EmojiGridItem.tsx`), hooks with `useCamelCase`, variables and props with camelCase, and Rust modules/functions with snake_case. Keep UI state separate from scanning data. Use Fluent UI v9 components, tokens, `makeStyles`, and `@fluentui/react-icons`; do not reintroduce Tailwind or another icon library.

## Testing Guidelines

Rust unit tests currently live in `#[cfg(test)]` modules and use descriptive snake_case names. Add tests for format filtering, scanning edge cases, and repository behavior when backend logic changes. No frontend test runner is configured; at minimum run `npm run build` and document manual checks in `MANUAL_ACCEPTANCE.md`. Do not perform automated visual review unless explicitly requested.

## Commit & Pull Request Guidelines

This directory currently has no Git history, so no established convention exists. Use concise English imperative messages, for example `Refine collapsible sidebar`. Before committing, summarize changed paths and checks performed. Pull requests should explain scope, user-visible behavior, limitations, and test results; include screenshots for UI changes when provided by the reviewer. Never commit secrets, generated `dist/`, `node_modules/`, `.npm-cache/`, or `src-tauri/target/`.

## Architecture & Safety Notes

Preserve the existing `scan_directory` and `load_thumbnail` command contracts unless a change is required. Original user images must remain in place; do not copy, move, rename, or delete them. Keep unavailable actions disabled and label limitations truthfully.
