"""Check deployment privacy boundaries with synthetic credentials and data."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_site


class DeploymentSecurityTests(unittest.TestCase):
    def test_requires_both_keys_before_creating_output(self):
        for missing in ('CARTO_BASEMAP_API_KEY', 'GOOGLE_PLACES_API_KEY'):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as root:
                env = {'CARTO_BASEMAP_API_KEY': 'synthetic-carto',
                       'GOOGLE_PLACES_API_KEY': 'synthetic-google'}
                del env[missing]
                destination = Path(root) / 'public'
                with mock.patch.dict(os.environ, env, clear=True):
                    with self.assertRaises(ValueError):
                        build_site.build_site(destination)
                self.assertFalse(destination.exists())

    def test_injects_keys_and_filters_data_without_modifying_source(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / 'source'
            for directory in ('css', 'js', 'img', 'data', 'scripts', 'docs'):
                (source / directory).mkdir(parents=True)
            (source / 'index.html').write_text('synthetic page')
            (source / 'js' / 'basemap-config.js').write_text('source keys are empty')
            (source / 'docs' / 'private-note.md').write_text('must not be published')
            data = {'type': 'FeatureCollection', 'features': [{
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [120.7, 24.1]},
                'properties': {'name': '測試消防栓', '修改帳號': 'synthetic-private-account',
                               '消防栓位置': '測試路口',
                               '說明': '種類: 地下式\n建檔帳號: synthetic-private-account\n'},
            }]}
            (source / 'data' / 'hydrants.geojson').write_text(json.dumps(data))
            output = Path(root) / 'public'
            env = {'CARTO_BASEMAP_API_KEY': 'synthetic-carto',
                   'GOOGLE_PLACES_API_KEY': 'synthetic-google'}
            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(
                build_site, '__file__', str(source / 'scripts' / 'build_site.py')
            ):
                build_site.build_site(output)
            config = (output / 'js' / 'basemap-config.js').read_text()
            self.assertIn('synthetic-carto', config)
            self.assertIn('synthetic-google', config)
            self.assertEqual((source / 'js' / 'basemap-config.js').read_text(),
                             'source keys are empty')
            self.assertEqual(json.loads((source / 'data' / 'hydrants.geojson').read_text()), data)
            public = json.loads((output / 'data' / 'hydrants.geojson').read_text())
            self.assertEqual(public['features'][0]['geometry'], data['features'][0]['geometry'])
            self.assertNotIn('修改帳號', public['features'][0]['properties'])
            self.assertEqual(public['features'][0]['properties']['說明'], '種類: 地下式\n')
            self.assertFalse((output / 'docs').exists())

    def test_rejects_output_in_source_checkout(self):
        source = Path(build_site.__file__).resolve().parent.parent
        env = {'CARTO_BASEMAP_API_KEY': 'synthetic-carto',
               'GOOGLE_PLACES_API_KEY': 'synthetic-google'}
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ValueError):
                build_site.build_site(source / '_site')


if __name__ == '__main__':
    unittest.main()
