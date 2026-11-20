# -*- coding: utf-8 -*-
"""List modules that nothing imports.

A module whose listeners are its whole purpose (the remote, the torrent status) is
reached by nobody's `import {}` - app.js has to ask for it by name, or it simply never runs. This
says which ones are in that position, so the list in app.js can be checked against reality.
"""
import io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'app', 'src', 'main', 'assets', 'js')

mods = {}
for root, _, files in os.walk(JS):
    for f in sorted(files):
        if f.endswith('.js'):
            p = os.path.join(root, f)
            mods[os.path.relpath(p, JS).replace(os.sep, '/')] = io.open(p, encoding='utf-8').read()

imported = set()
for m, src in mods.items():
    base = os.path.dirname(m)
    for spec in re.findall(r"from\s*'([^']+)'", src) + re.findall(r"^import\s*'([^']+)';", src, re.M):
        imported.add(os.path.normpath(os.path.join(base, spec)).replace(os.sep, '/'))

orphans = [m for m in sorted(mods) if m not in imported and m != 'app.js']
for m in orphans:
    print('nothing imports', m)
print(f'{len(mods)} modules, {len(orphans)} reached by nobody')
sys.exit(1 if orphans else 0)
