// Phase 7: Windows-specific platform modules (foreground window capture,
// window activation, synthetic input). Hidden behind `#[cfg(windows)]` so
// the rest of the crate compiles unchanged on macOS/Linux.

#[cfg(windows)]
pub mod windows;
