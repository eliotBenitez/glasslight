# Contributing to Glasslight

Thanks for your interest in helping out. The project targets GNOME Shell 50 and
uses GJS with ES modules — no Node.js, package manager, or transpilation step.

## Setting up

You'll need `gjs`, `glib-compile-schemas`, GNU gettext, `zip`, `unzip`, `make`,
and Python 3. On Debian/Ubuntu:

```sh
sudo apt install gjs libglib2.0-bin gettext zip unzip make python3
```

Validate the sources and build the installable archive:

```sh
make check
make package
```

The archive appears at `dist/Glasslight-GNOME-50.shell-extension.zip`.

## Source layout

- `extension.js`: GNOME entry point, re-exporting `src/extension.js`.
- `src/extension.js`: launcher lifecycle and integration.
- `src/core/`: actions, media control, clipboard files, and Settings discovery.
- `src/search/`: ranking, application catalogue, calculator, and web-search helpers.
- `src/ui/`: Shell actors and native glass effects.
- `src/shared/`: constants and Shell-side localization.
- `prefs.js`: separate Libadwaita preferences entry point, sharing only
  Shell-independent search helpers.
- `tests/`: GJS core tests and Python module-layout/archive checks.

Keep `metadata.json`, `stylesheet.css`, `extension.js`, and `prefs.js` at the
archive root for GNOME. The build preserves the `src/` hierarchy without a
transpilation step. `make check` validates relative imports and module
reachability; `make package` also checks that archived modules match the sources.
See [AGENTS.md](AGENTS.md) for lifecycle and localization conventions.

## Change guidelines

- Preserve the `glasslight` UUID and the existing JavaScript style.
- Wrap new user-facing strings in `_()`, `ngettext()`, or `pgettext()`, and
  update the `po/` files and the compiled translation.
- Any new signal, timer, cancellable, or actor must be cleaned up in
  `disable()`.
- Don't add remote image downloads, on-disk clipboard storage, or sending
  search text over the network without a separate discussion and documentation.
- Update the README when visible behavior changes.

## Manual testing

After installing JavaScript changes, log out of GNOME and back in — the Shell
may reuse cached ES modules. At a minimum, verify opening and closing, arrow and
Tab navigation, Enter, `Ctrl+0`–`Ctrl+4`, the changed mode with empty, valid,
invalid, and non-Latin input, both themes, a narrow screen, and disabled
animations. After a disable/enable cycle, no stale actors, timers, or handlers
should remain.

Inspect Shell errors with:

```sh
journalctl /usr/bin/gnome-shell -b -f
```

Remove clipboard contents and private paths before sharing a log.
