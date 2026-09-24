"""Pruebas del servidor Flask.  Uso (desde servidor/):  python -m unittest test_servidor -v"""
import os
import unittest

from app import create_app
from app.routes import librerias_locales


class ServidorTest(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.cliente = self.app.test_client()

    def test_pagina_principal(self):
        r = self.cliente.get("/")
        self.assertEqual(r.status_code, 200)
        html = r.get_data(as_text=True)
        self.assertIn("S.A.C.A.", html)
        self.assertIn('id="vista-anonimizar"', html)
        self.assertIn("/static/anonimizador/js/app.js", html)
        self.assertIn("/static/anonimizador/css/saca.css", html)
        self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(r.headers["Referrer-Policy"], "no-referrer")

    def test_librerias_locales_si_existen(self):
        html = self.cliente.get("/").get_data(as_text=True)
        vendor = os.path.join(self.app.config["REPO_DIR"], "vendor", "pdf.min.mjs")
        if os.path.isfile(vendor):
            self.assertIn("window.ANONIMIZADOR_LIBRERIAS", html)
            with self.app.test_request_context():
                self.assertEqual(librerias_locales()["pdfjs"], "/static/anonimizador/vendor/pdf.min.mjs")
        else:
            self.assertNotIn("window.ANONIMIZADOR_LIBRERIAS", html)

    def test_tipos_mime(self):
        casos = {
            "/static/anonimizador/js/app.js": "text/javascript",
            "/static/anonimizador/css/anonimizador.css": "text/css",
        }
        if os.path.isfile(os.path.join(self.app.config["REPO_DIR"], "vendor", "pdf.min.mjs")):
            casos["/static/anonimizador/vendor/pdf.min.mjs"] = "text/javascript"
        for url, tipo in casos.items():
            r = self.cliente.get(url)
            self.assertEqual(r.status_code, 200, url)
            self.assertTrue(r.mimetype == tipo, f"{url}: {r.mimetype}")
            r.close()

    def test_no_expone_otros_archivos(self):
        for url in ["/static/anonimizador/.git/config", "/static/anonimizador/servidor/config.py",
                    "/static/anonimizador/js/../servidor/config.py", "/static/anonimizador/README.md",
                    "/static/otro/js/app.js", "/static/anonimizador/js/", "/static/anonimizador/js/no-existe.js"]:
            r = self.cliente.get(url)
            self.assertEqual(r.status_code, 404, url)


if __name__ == "__main__":
    unittest.main()
