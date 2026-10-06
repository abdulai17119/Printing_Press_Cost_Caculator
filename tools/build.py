from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
html = (root / 'index.html').read_text()
css = (root / 'src/app.css').read_text()
html, count = re.subn(r'<style>.*?</style>', lambda _: '<style>\n' + css.rstrip() + '\n</style>', html, count=1, flags=re.S)
assert count == 1, 'Expected one inline stylesheet'
sources = iter(['engine.js', 'seed.js', 'cloud.js'])
assert len(re.findall(r'<script>.*?</script>', html, re.S)) == 3, 'Expected three inline app scripts'
html = re.sub(r'<script>.*?</script>', lambda _: '<script>\n' + (root / 'src' / next(sources)).read_text().rstrip() + '\n</script>', html, flags=re.S)
(root / 'index.html').write_text(html)
print('Rebuilt index.html')
