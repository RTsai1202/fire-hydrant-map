"""Package public site assets and inject the CARTO key without committing it."""

import json
import os
from pathlib import Path
import shutil
import sys


def build_site(destination):
    key = os.environ.get('CARTO_BASEMAP_API_KEY', '').strip()
    if not key:
        raise ValueError('CARTO_BASEMAP_API_KEY is required for CARTO deployment')
    source = Path(__file__).resolve().parent.parent
    destination = Path(destination).resolve()
    # Never overwrite source assets or an existing build containing credentials.
    if destination == source or source in destination.parents or destination in source.parents:
        raise ValueError('Build destination must be outside the source checkout')
    destination.mkdir(parents=True, exist_ok=False)
    shutil.copy2(source / 'index.html', destination / 'index.html')
    for directory in ('css', 'js', 'img', 'data'):
        shutil.copytree(source / directory, destination / directory)
    config = 'window.CARTO_BASEMAP_API_KEY = ' + json.dumps(key) + ';\n'
    (destination / 'js' / 'basemap-config.js').write_text(config, encoding='utf-8')
    print('Site packaged with CARTO configuration; key omitted from logs.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/build_site.py <new-output-directory>')
    build_site(sys.argv[1])
