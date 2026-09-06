<div align="center">

# Glasslight

### A fast, keyboard-first launcher with native glass for GNOME Shell 50

[![CI](https://github.com/eliotBenitez/glasslight/actions/workflows/ci.yml/badge.svg)](https://github.com/eliotBenitez/glasslight/actions/workflows/ci.yml)
![GNOME Shell 50](https://img.shields.io/badge/GNOME%20Shell-50-4A86CF?logo=gnome&logoColor=white)
![GJS](https://img.shields.io/badge/GJS-ES%20modules-F7DF1E?logo=javascript&logoColor=111)

**English** · [Русский](README.ru.md)

Search apps and files, run useful actions, calculate expressions, and reuse your
clipboard — without leaving the keyboard.

![Glasslight application catalogue](assets/screenshots/glasslight-apps.png)

</div>

## Why Glasslight?

Glasslight turns `Alt+Space` into a compact command surface that expands only
when you need results. It is built directly for GNOME Shell in modern GJS: no
Electron, no browser runtime, no background server, and no cloud search while
you type.

- **Native glass** — live Shell background sampling with GPU-powered
  `Shell.BlurEffect`, a rounded mask, adaptive tint, and crisp foreground text.
- **Four focused modes** — applications, files, actions, and clipboard history,
  available from the mouse or `Ctrl+1` through `Ctrl+4`.
- **Useful without plugins** — calculator, timers, alarms, password and UUID
  generation, text conversion, media controls, and system actions are built in.
- **Local-first by design** — search and clipboard history stay on your device.
  A web query is opened only after you explicitly activate the DuckDuckGo row.
- **Made for the keyboard** — predictable arrows, Enter, Escape, Tab navigation,
  category shortcuts, and Quick Keys.

## See it in action

| Compact launcher | Built-in calculator |
| --- | --- |
| ![Glasslight compact launcher](assets/screenshots/glasslight-home.png) | ![Glasslight calculator](assets/screenshots/glasslight-calculator.png) |

The screenshots show the real extension running in GNOME Shell 50's Mutter
Development Kit. The blue desktop is the isolated test session background.

## What you can do

### Find and launch applications

Browse every installed application in a responsive grid or list, filter by
desktop categories, or search by name, description, keyword, and desktop ID.
Favorites and GNOME's existing frequently used apps appear as suggestions;
Glasslight does not collect its own usage statistics.

### Find local files

Glasslight indexes your home and standard user directories asynchronously, up
to 20,000 files and six directory levels. Search is performed against names and
paths. Hidden directories, symlinks, and common build directories are skipped.

### Run actions

Twenty local and system actions are included. Parameterized actions continue
inside the same launcher, so you can start a timer, choose a password length,
or transform text without opening another dialog.

```text
rn 1 100      timer 10m      alarm 07:30
coin          dice 20        pass 24        uuid
case upper Text               dnd
play          next           prev
date          time           clipclear
settings      shot           apps           home           lock
```

### Calculate expressions

Type an expression in global search or Actions mode. Press Enter to copy its
plain numeric result.

```text
3*(4+1)                         → 15
2^10                            → 1,024
sqrt(2)                         → 1.4142135624
sin(pi/6)                       → 0.5
sin²(pi/6)                      → 0.25
sin⁻¹(0.5)                      → 0.5235987756
```

Supported syntax includes `+ - * / % ^`, parentheses, decimal comma, scientific
notation, Unicode operators, superscript powers, `sqrt`, `ln`, `log`, `abs`,
trigonometric and inverse trigonometric functions, `pi`, and `e`. Evaluation is
local and uses a dedicated parser — never `eval`.

### Reuse clipboard content

Keep up to 20 text, image, and local-file entries in memory, with a total data
budget of 32 MiB. Image previews support PNG, JPEG, WebP, and BMP when the
matching GdkPixbuf decoder is available. Remote image URLs are never downloaded,
and history disappears when the extension or Shell session ends.

## Keyboard controls

| Shortcut | Action |
| --- | --- |
| `Alt+Space` | Open or close Glasslight |
| `Ctrl+0` | Return to global search |
| `Ctrl+1` | Applications |
| `Ctrl+2` | Files |
| `Ctrl+3` | Actions |
| `Ctrl+4` | Clipboard |
| `↑` / `↓` | Select a result |
| `←` / `→` | Navigate the application grid |
| `Alt+←` / `Alt+→` | Change application category |
| `Tab` / `Shift+Tab` | Move between controls |
| `Enter` | Open, run, or copy the selected result |
| `Esc` | Cancel the current action or close Glasslight |

## Requirements

- GNOME Shell **50**
- `gnome-extensions` for installation and preferences
- For source builds: `gjs`, `glib-compile-schemas`, GNU gettext, `make`, `zip`,
  `unzip`, and Python 3

Glasslight currently targets GNOME Shell 50 only. Compatibility metadata is kept
intentionally strict until other Shell versions are tested.

## Install from source

```sh
git clone https://github.com/eliotBenitez/glasslight.git
cd glasslight
make check
make package
gnome-extensions install --force dist/Glasslight-GNOME-50.shell-extension.zip
```

Log out of GNOME and sign in again, then enable the extension:

```sh
gnome-extensions enable glasslight
```

GNOME Shell caches ES modules, so a disable/enable cycle is not sufficient after
installing JavaScript updates. A fresh login is required for final validation.

If GNOME's window menu already uses `Alt+Space`, release that shortcut with:

```sh
gsettings set org.gnome.desktop.wm.keybindings activate-window-menu "[]"
```

Restore the original window-menu shortcut with:

```sh
gsettings set org.gnome.desktop.wm.keybindings activate-window-menu "['<Alt>space']"
```

## Preferences

```sh
gnome-extensions prefs glasslight
```

You can change the light/dark/system appearance, native blur radius, clipboard
history, and activation shortcut. The grid/list catalogue layout is switched
from the menu inside Applications mode. Settings are stored through GSettings.

## Development

```sh
make check      # metadata, schema, translations, and core GJS tests
make package    # regenerate compiled resources and build the installable ZIP
make install    # build and install locally
```

The GitHub Actions workflow runs the same checks and verifies that every release
archive contains its required modules, compiled schema, and translation.

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture notes, localization
commands, lifecycle rules, and the GNOME Shell manual-test checklist.

## Privacy and limits

- Clipboard history is memory-only and is never persisted by Glasslight.
- Search text is not sent over the network while typing.
- DuckDuckGo opens only when its result is activated.
- Passwords use unbiased bytes read from `/dev/urandom`.
- Timers and alarms exist only for the current Shell session.
- File search uses an in-memory name/path index, not document contents.

## Design note

Glasslight draws inspiration from contemporary translucent interfaces and
Apple's public Liquid Glass and Spotlight documentation, but it is an independent
GNOME extension. It does not ship Apple assets, SF Symbols, or proprietary
optical-refraction technology.

Native blur is implemented with GNOME Shell's own `Shell.BlurEffect` and a custom
rounded GPU mask. See the [GNOME API documentation](https://gnome.pages.gitlab.gnome.org/gnome-shell/shell/class.BlurEffect.html)
for the underlying effect.
