"""Package public site assets and inject restricted browser keys outside Git."""

import json
import os
from pathlib import Path
import shutil
import sys

from sync_data import sanitize_collection


def build_site(destination):
    key = os.environ.get('CARTO_BASEMAP_API_KEY', '').strip()
    if not key:
        raise ValueError('CARTO_BASEMAP_API_KEY is required for CARTO deployment')
    google_key = os.environ.get('GOOGLE_PLACES_API_KEY', '').strip()
    if not google_key:
        raise ValueError('GOOGLE_PLACES_API_KEY is required to preserve Places search')
    source = Path(__file__).resolve().parent.parent
    destination = Path(destination).resolve()
    # Never overwrite source assets or an existing build containing credentials.
    if destination == source or source in destination.parents or destination in source.parents:
        raise ValueError('Build destination must be outside the source checkout')
    destination.mkdir(parents=True, exist_ok=False)
    shutil.copy2(source / 'index.html', destination / 'index.html')
    for directory in ('css', 'js', 'img', 'data'):
        shutil.copytree(source / directory, destination / directory)
    hydrants = destination / 'data' / 'hydrants.geojson'
    public_data = sanitize_collection(json.loads(hydrants.read_text(encoding='utf-8')))
    hydrants.write_text(json.dumps(public_data, ensure_ascii=False, separators=(',', ':')),
                        encoding='utf-8')
    config = 'window.CARTO_BASEMAP_API_KEY = ' + json.dumps(key) + ';\n'
    config += 'window.GOOGLE_PLACES_API_KEY = ' + json.dumps(google_key) + ';\n'
    (destination / 'js' / 'basemap-config.js').write_text(config, encoding='utf-8')
    print('Site packaged with map/search configuration; keys omitted from logs.')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python3 scripts/build_site.py <new-output-directory>')
    build_site(sys.argv[1])
