EXTENSION_UUID := glasslight
ARCHIVE := dist/Glasslight-GNOME-50.shell-extension.zip
JS_FILES := $(sort $(wildcard *.js) $(wildcard src/*.js) $(wildcard src/*/*.js))

.PHONY: all check package install clean

all: check

check:
	python3 -m json.tool metadata.json >/dev/null
	glib-compile-schemas --strict --dry-run schemas
	msgfmt --check --statistics po/ru.po -o /dev/null
	gjs -m tests/core.test.js
	python3 tests/layout.test.py

package: check
	glib-compile-schemas --strict schemas
	msgfmt --check po/ru.po -o locale/ru/LC_MESSAGES/$(EXTENSION_UUID).mo
	mkdir -p dist
	zip -FSrq $(ARCHIVE) $(JS_FILES) icon.png stylesheet.css metadata.json LICENSE schemas locale
	unzip -tq $(ARCHIVE)
	python3 tests/layout.test.py $(ARCHIVE)
	@printf 'Created %s\n' '$(ARCHIVE)'

install: package
	gnome-extensions install --force $(ARCHIVE)

clean:
	$(RM) $(ARCHIVE)
