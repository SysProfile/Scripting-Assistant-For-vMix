# Changelog

## [0.7.0] - 2026-04-30

### Added
- **Hot reload** of linked `.vmix` project: external file changes auto-reload Inputs/Objects (debounced 500ms).
- **vMix HTTP API integration**: new commands "Run script in vMix" and "Refresh Inputs from vMix" using REST API at `http://localhost:8088/api/`. Configurable via `vmixScripting.apiUrl`.
- **Hover provider**: shows function description, parameters, range and example on hover over `API.Cat.Func`, `InputsList.X`, `ObjectsList.X`, `DataSource.X`.
- **Folding ranges**: collapse `If/For/While/Do/Select Case` blocks. Supports `'#region` / `'#endregion` markers.
- **Document outline**: navigable structure via Breadcrumbs, including section comments (`'-- Section --`), `Dim` declarations, and API calls.
- **Definition provider**: `Ctrl+Click` on `InputsList.X` / `ObjectsList.X` opens linked `.vmix` project.
- **Code Actions (Quick Fixes)**: convert `API.Function("X", ...)` to typed call, add missing script name comment, fix keyword casing.
- **Linter**: warnings for missing `Wait` between consecutive calls on same input, suggestion to use typed API over `API.Function("X")`, detection of infinite loops without exit.
- **Reserved word diagnostic**: error when declaring variables named `Error`, `Stop`, `Open`, `Resume`, etc.
- **Static snippets**: `wait`, `ifprogram`, `fadein`, `fadeout`, `looploop`, `cycleinputs`, `gtsettext`, `gtsetimage`, `cutto`, `fadeto`, `overlayon`, `overlayoff`, `tally`.
- **Dynamic snippets**: per-Input `cut-Name`, `fade-Name`, and `gt-Name` shortcuts generated from project data.
- **Templates**: "New script from template" with Lower Third, Cycle Inputs, Toggle Audio, Tally React.
- **Round-trip verification**: command to export+reimport and diff to detect data loss.
- **Standalone export**: save exported script as `.vb` file outside the project.
- **Status bar enhancement**: shows linked project filename and input count, or warning if not linked.
- **Portuguese (pt-br) translations**.
- **GitHub Actions CI**: lint + compile on PRs.

### Changed
- **Performance**: O(1) function lookup via indexed `Map` (replaces linear `.find()` across completion, diagnostics, signature, transpiler).
- **Performance**: diagnostics debounced 250ms on document changes.
- **Robustness**: `updateScriptInProject` now writes atomically (`.tmp` + rename) to prevent corrupting `.vmix` on crash.
- **Robustness**: XML parsing migrated to `parseStringPromise`.
- **Type inference**: `Dim x = literal` (without `As Type`) now infers type for type-mismatch diagnostics.
- **Activation**: `vmix` language no longer auto-activates on `.vb` files (avoids interfering with VB.NET projects).
- Errors during `vMix.json` integrity correction now show a warning instead of silent `console.error`.

### Fixed
- Edge case where `loadVMixProjectData()` could return stats before async XML parse completed.
- Duplicate variable rastreo passes in `completion.ts` consolidated into single regex pass.

## [0.6.55] - 2026
- Previous releases.