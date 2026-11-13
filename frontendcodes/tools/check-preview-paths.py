"""Offline preview routing checks; no server sockets or real project data."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('preview', Path(__file__).with_name('preview-sign-build.py'))
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class PreviewPaths(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'export'
        self.root.mkdir()
        (self.root / 'index.html').write_text('home')
        (self.root / 'sign-lab.html').write_text('lab')
        (self.root / '_expo').mkdir()
        (self.root / '_expo' / 'app.js').write_text('example')
        self.handler = preview.PreviewHandler.__new__(preview.PreviewHandler)
        self.handler.export_root = self.root.resolve()
        self.handler.base_path = '/Sign-Language'

    def route(self, url):
        return Path(self.handler.translate_path(url))

    def test_export_routes_and_assets(self):
        self.assertEqual(self.route('/Sign-Language/'), self.root / 'index.html')
        self.assertEqual(self.route('/Sign-Language/sign-lab?x=1'), self.root / 'sign-lab.html')
        self.assertEqual(self.route('/Sign-Language/_expo/app.js'), self.root / '_expo/app.js')

    def test_prefix_boundary(self):
        for url in ['/sign-lab', '/Sign-Language-other/sign-lab']:
            self.assertFalse(self.route(url).exists())

    def test_hidden_and_encoded_traversal(self):
        for url in ['/Sign-Language/.env', '/Sign-Language/../outside',
                    '/Sign-Language/%2e%2e/outside', '/Sign-Language/%2eenv']:
            self.assertFalse(self.route(url).exists())

    def test_external_symlink(self):
        outside = Path(self.temp.name) / 'outside.txt'
        outside.write_text('outside')
        (self.root / 'link.txt').symlink_to(outside)
        self.assertFalse(self.route('/Sign-Language/link.txt').exists())

    def test_directory_listing_disabled(self):
        errors = []
        self.handler.send_error = errors.append
        self.assertIsNone(self.handler.list_directory(str(self.root)))
        self.assertEqual(errors, [404])


if __name__ == '__main__':
    unittest.main()
