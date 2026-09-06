EXTENSION_UUID := tahoe-spotlight@codex
ARCHIVE := dist/Tahoe-Spotlight-GNOME-50.shell-extension.zip
JS_FILES := $(sort $(wildcard *.js))

.PHONY: all check package install clean

all: check

check:
	python3 -m json.tool metadata.json >/dev/null
	glib-compile-schemas --strict --dry-run schemas
	msgfmt --check --statistics po/ru.po -o /dev/null
	gjs -m tests/core.test.js

package: check
	glib-compile-schemas --strict schemas
	msgfmt --check po/ru.po -o locale/ru/LC_MESSAGES/$(EXTENSION_UUID).mo
	mkdir -p dist
	zip -FSrq $(ARCHIVE) $(JS_FILES) stylesheet.css metadata.json schemas locale
	unzip -tq $(ARCHIVE)
	@printf 'Created %s\n' '$(ARCHIVE)'

install: package
	gnome-extensions install --force $(ARCHIVE)

clean:
	$(RM) $(ARCHIVE)
