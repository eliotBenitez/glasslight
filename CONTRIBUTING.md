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
