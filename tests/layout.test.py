from pathlib import Path
import re
import sys
from zipfile import ZipFile


ROOT = Path(__file__).resolve().parent.parent
ENTRY_POINTS = {'extension.js', 'prefs.js'}
IMPORT_PATTERN = re.compile(r"\bfrom\s+['\"](\.[^'\"]+)['\"]")


def check_layout(sources):
    assert ENTRY_POINTS <= sources.keys(), 'Missing GNOME entry points'
    pending = list(ENTRY_POINTS)
    visited = set()
    while pending:
        name = pending.pop()
        if name in visited:
            continue
        visited.add(name)
        for target in IMPORT_PATTERN.findall(sources[name]):
            resolved = (ROOT / name).parent.joinpath(target).resolve()
            assert resolved.is_relative_to(ROOT), f'{name}: import outside extension'
            dependency = resolved.relative_to(ROOT).as_posix()
            assert dependency in sources, f'{name}: missing import {target}'
            pending.append(dependency)
    assert visited == sources.keys(), f'Unreachable modules: {sources.keys() - visited}'


sources = {path.relative_to(ROOT).as_posix(): path.read_text()
           for path in [*ROOT.glob('*.js'), *ROOT.glob('src/**/*.js')]}
check_layout(sources)
assert set(path.name for path in ROOT.glob('*.js')) == ENTRY_POINTS

if len(sys.argv) > 1:
    with ZipFile(sys.argv[1]) as archive:
        packaged = {name: archive.read(name).decode()
                    for name in archive.namelist() if name.endswith('.js')}
        check_layout(packaged)
        assert packaged == sources, 'Archive JavaScript differs from source tree'
        for required in ['metadata.json', 'stylesheet.css', 'icon.png',
                         'schemas/gschemas.compiled',
                         'locale/ru/LC_MESSAGES/glasslight.mo']:
            assert archive.read(required) == (ROOT / required).read_bytes(), required

print('Layout tests passed')
