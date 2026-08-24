# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the React + TypeScript UI; `src/app/` owns the desktop shell and settings.
- `src/features/` groups import, library-grid, and quick-search code; keep hooks beside components.
- `src/lib/tauri.ts` is the Tauri command boundary; shared contracts live in `src/types.ts`.
- `src-tauri/src/` contains Rust services. `scanner.rs` and `thumbnail.rs` handle local images, `recent.rs` owns recent-history JSON persistence, and `tray.rs` owns system-tray behavior.
- `src-tauri/icons/` contains app assets. Documentation lives in `README.md`, `MANUAL_ACCEPTANCE.md`, and `docs/`; see `docs/system-tray-recent-usage.md`.

## Build, Test, and Development Commands

```powershell
npm install
npm run tauri dev
npm run build
npm run tauri build -- --no-bundle
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

`npm run tauri dev` launches the app; `npm run build` checks TypeScript and builds Vite. The no-bundle command creates `src-tauri/target/release/emobox.exe`. Cargo commands format, compile, test, and lint Rust.

## Coding Style & Naming Conventions

Use two-space indentation in TypeScript and let `cargo fmt` format Rust. Name React components/files with PascalCase (`EmojiGridItem.tsx`), hooks with `useCamelCase`, variables and props with camelCase, and Rust modules/functions with snake_case. Keep UI state separate from scanning and persistence state. Use Fluent UI v9 components, tokens, `makeStyles`, and `@fluentui/react-icons`; do not add Tailwind or another icon library.

## Testing Guidelines

Rust tests live in `#[cfg(test)]` modules and use descriptive snake_case names. Add tests for filtering, scanning edge cases, and recent-history ordering, counting, and serialization. No frontend test runner exists; run `npm run build` and update `MANUAL_ACCEPTANCE.md`. Tray visibility, close-to-hide, focus, and process exit require Windows manual testing. Do not perform automated visual review unless explicitly requested.

## Commit & Pull Request Guidelines

Follow the existing concise English imperative, hyphenated style, for example `Implement-tray-and-recent-history-persistence`. Before committing, show staged paths and checks performed. Pull requests should explain scope, behavior, limitations, and test results; include supplied UI screenshots. Never commit secrets or generated `dist/`, `node_modules/`, `.npm-cache/`, `src-tauri/target/`, installers, or EXE files.

## Architecture & Safety Notes

Preserve `scan_directory`, `load_thumbnail`, and clipboard command contracts unless a change is required. Closing the main window must hide it; only the tray `退出` action should terminate the process. Settings remain in `localStorage: emobox.settings`; recent use is stored locally in `%APPDATA%\com.emobox.app\recent-images.json`. Do not introduce cloud services, accounts, or SQLite. Original user images must remain in place—never copy, move, rename, or delete them. Keep unavailable actions disabled and label limitations truthfully.
