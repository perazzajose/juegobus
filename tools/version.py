"""Sube la versión del juego en index.html (window.BUILD y los ?v= de los scripts) y en version.js.
Correr antes de cada subida, desde la carpeta del juego:  py tools/version.py
Así los celulares que tenían guardada la versión anterior se recargan solos con la nueva."""
import datetime, pathlib, re

raiz = pathlib.Path(__file__).resolve().parent.parent
html = (raiz / 'index.html').read_text(encoding='utf-8')
actual = re.search(r"window\.BUILD = '([^']+)'", html).group(1)
hoy = datetime.date.today().strftime('%Y%m%d')
fecha, _, n = actual.partition('-')
nueva = f"{hoy}-{int(n) + 1 if fecha == hoy and n.isdigit() else 1}"
html = html.replace(f"window.BUILD = '{actual}'", f"window.BUILD = '{nueva}'")
html = re.sub(r'\?v=[0-9]{8}-[0-9]+', f'?v={nueva}', html)
(raiz / 'index.html').write_text(html, encoding='utf-8')
vjs = (raiz / 'version.js').read_text(encoding='utf-8')
(raiz / 'version.js').write_text(re.sub(r"window\.LATEST = '[^']+'", f"window.LATEST = '{nueva}'", vjs), encoding='utf-8')
print(f'Versión: {actual} -> {nueva}')
