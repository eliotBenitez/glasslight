# Repository Guidelines

## Project Overview

Glasslight is a GNOME Shell 50 extension that provides a keyboard-driven launcher for applications, files, actions, calculations, and clipboard history. It is written in modern GJS using ES modules and GNOME introspection APIs; there is no Node.js runtime, package manager, transpilation step, or browser DOM.

The extension UUID is `glasslight`. Preserve it in `metadata.json`, schema paths, install commands, and settings lookups unless the project is intentionally forked under a new identity.

## Project Structure & Module Organization

- `extension.js` is the integration layer. It owns enable/disable lifecycle, actors, input handling, result rendering, file indexing, clipboard history, and activation.
- `glass.js` implements the masked native `Shell.BlurEffect` surface and tracks scene changes. Keep GPU-effect and background-sampling logic here.
- `actions.js`, `actionUtils.js`, `mpris.js`, and `random.js` define built-in actions, input parsing, media control, and secure random generation.
- `appCatalog.js`, `search.js`, and `calculator.js` contain focused ranking, normalization, and expression-evaluation logic. Prefer small, side-effect-free helpers in these files.
- `clipboardFiles.js` validates clipboard MIME types and reads local image/file data with byte limits and cancellation.
- `widgets.js` contains reusable actor factories; `constants.js` contains shared modes, limits, grid dimensions, and motion timings.
- `prefs.js` builds the Libadwaita preferences UI. `stylesheet.css` contains all Shell theme rules.
- `metadata.json` declares extension compatibility and the `gettext-domain` (`glasslight`). `schemas/*.gschema.xml` defines persistent settings; `schemas/gschemas.compiled` is generated from it.
- `i18n.js` exposes the shell-side gettext helpers (`_`, `ngettext`, `pgettext`, and a `%s`/`%d` `format()`), resolved from the extension via `Extension.lookupByURL`. `prefs.js` imports gettext from the prefs resource instead, since it runs in a separate process.
- `po/glasslight.pot` is the message template; `po/<lang>.po` are the translations, compiled to `locale/<lang>/LC_MESSAGES/glasslight.mo`.
- `tests/core.test.js` covers the Shell-independent calculator, search, and application-catalogue helpers with GJS.
- `Makefile` provides the validation, packaging, and local installation entry points; `.github/` contains CI and contribution templates.
- `README.md` is the default English user-facing reference; `README.ru.md` is its Russian companion. Keep behavior, installation, privacy, limitations, and screenshot links synchronized when visible behavior changes.

## Localization

All user-facing strings are English source text wrapped in `_()` (or `ngettext()`), translated at runtime through gettext; translations follow the active GNOME locale. The `MODES`/`CATEGORIES` tables in `constants.js`/`appCatalog.js` keep plain English `name`/`hint` values (no `_()` there — the module is imported before the gettext domain binds) and are translated at their render sites in `extension.js`.

After changing or adding a translatable string, refresh the template and translations:

```sh
xgettext --language=JavaScript --from-code=UTF-8 \
  --keyword=_ --keyword=ngettext:1,2 --keyword=pgettext:1c,2 \
  --package-name="Glasslight" --output=po/glasslight.pot *.js
```

Strings passed to `_()` as variables (the `MODES`/`CATEGORIES` names) are invisible to `xgettext`; keep their manual entries at the end of the `.pot` in sync. Then merge and compile:

```sh
msgmerge --update po/ru.po po/glasslight.pot
msgfmt po/ru.po -o locale/ru/LC_MESSAGES/glasslight.mo
```

Add a new language by running `msginit --locale=<code> --input=po/glasslight.pot --output-file=po/<code>.po`, translating it, and compiling it to the matching `locale/<code>/LC_MESSAGES/` path. Include the regenerated `.mo` with the change, and add `po` and `locale` to the packaging `zip` command.

## Architecture & Lifecycle

`enable()` creates settings, signal registries, transient state, the launcher actors, keybinding, clipboard listener, and asynchronous file index. `disable()` must fully reverse that work. Any new signal, timeout, cancellable operation, keybinding, or actor must have an explicit cleanup path. Use the existing `_connect()` registry for long-lived signals and remove GLib sources once they fire or during shutdown.

Input is debounced before search. The active mode selects the relevant source, while rendering and activation remain centralized in `extension.js`. Keep reusable parsing and ranking outside that file to avoid making the main class harder to maintain.

## Build, Install, and Development Commands

Run commands from the repository root:

```sh
make check
make package
make install
gnome-extensions prefs glasslight
gnome-extensions disable glasslight
gnome-extensions enable glasslight
```

`make check` validates metadata, translations, the XML schema, and pure-JavaScript core tests. `make package` also refreshes `schemas/gschemas.compiled` and the compiled Russian catalogue, then creates the distributable archive in `dist/`. Run it after schema or translation edits and include regenerated tracked files with the change.

To create a distributable archive with metadata at the ZIP root:

```sh
mkdir -p dist
zip -r dist/Glasslight-GNOME-50.shell-extension.zip \
  *.js stylesheet.css metadata.json schemas locale
gnome-extensions install --force \
  dist/Glasslight-GNOME-50.shell-extension.zip
```

After installing JavaScript changes, log out of GNOME and back in before enabling the extension. Disable/enable alone may reuse cached ES modules. Preferences-only or CSS experiments may reload more easily, but final validation must use a fresh session.

## Coding Style & Naming Conventions

Match the existing JavaScript style: four-space indentation, single quotes, semicolons, and compact object literals where readability permits. Order imports as GNOME `gi://` modules, Shell `resource:///` modules, then local `./` modules. Use `camelCase` for functions and values, `PascalCase` for classes, and `UPPER_SNAKE_CASE` for exported constants. Private implementation members use a leading underscore, for example `_queueSearch()` and `_clipboardCancel`.

Use braces for multiline control flow. Keep callbacks short; extract parsing or domain logic into a focused module. Comments should explain GNOME-specific constraints, lifecycle reasons, or non-obvious invariants rather than restating code. User-facing strings currently follow the language already used in the surrounding UI.

Do not introduce Node-only APIs, `eval`, browser globals, or asynchronous work that outlives `disable()`. Prefer `Gio`, `GLib`, `Clutter`, `St`, and other platform APIs already used by the project.

## Testing Guidelines

The lightweight GJS suite covers only Shell-independent helpers. Run `make check`, then test integration in a GNOME Shell 50 session and record the manual checks in the pull request. At minimum:

1. Open and close with `Alt+Space`, outside click, and `Esc`.
2. Check keyboard focus, arrows, Enter, Tab/Shift+Tab, and `Ctrl+0` through `Ctrl+4`.
3. Exercise the changed mode with empty, valid, invalid, and non-Latin input.
4. Verify compact/expanded layout, narrow monitor sizing, light/dark themes, and animations disabled.
5. Open preferences, change affected settings, and confirm they persist.
6. Disable and re-enable the extension; confirm no stale actors, timers, notifications, or duplicate signal handlers remain.

For schema-only validation, use `glib-compile-schemas --strict --dry-run schemas`. Inspect runtime failures with:

```sh
journalctl /usr/bin/gnome-shell -b -f
```

Search for the `[Glasslight]` prefix. Include relevant errors in bug reports, but remove private clipboard contents and local paths.

## Security, Privacy & Resource Limits

Preserve the project’s local-first behavior. Clipboard history stays in memory, remote image URLs are not downloaded, and search text is not sent while typing. The DuckDuckGo query is opened only when the user activates its result. Keep existing image and clipboard byte limits, file-index bounds, cancellation, and `/dev/urandom`-backed password generation intact. Any change that adds persistence, network access, subprocesses, or broader filesystem traversal must be documented prominently in both the PR and `README.md`.

## Commit & Pull Request Guidelines

Use a short imperative subject, such as `Fix clipboard image cleanup` or `Add category keyboard navigation`. Keep refactors separate from behavior changes when practical.

Pull requests should describe the user-visible result, motivation, GNOME Shell version tested, and exact verification steps. Link related issues. Include before/after screenshots or a short recording for layout, glass, animation, or preference changes. Call out modifications to `metadata.json`, settings schemas, permissions/privacy behavior, packaging, and known limitations.
