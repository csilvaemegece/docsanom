"""Rutas del módulo Anonimizador.

El servidor solo entrega la página y sus archivos: la causa se procesa en el navegador y nunca llega
aquí. Por eso no hay rutas que reciban documentos ni base de datos.
"""
import os

from flask import Blueprint, abort, current_app, render_template, send_from_directory, url_for

bp = Blueprint("main", __name__)

# Carpetas del repositorio que se publican bajo /static/anonimizador/<carpeta>/...
CARPETAS_PUBLICAS = ("css", "js", "vendor")


@bp.route("/")
def anonimizador():
    return render_template(
        "anonimizador.html",
        active_page="anonimizador",
        librerias_locales=librerias_locales(),
    )


# Se registra como endpoint "static" de la aplicación (ver app/__init__.py). Solo publica css/, js/ y
# vendor/ del repositorio; cualquier otra ruta (por ejemplo .git o el código del servidor) da 404.
def estaticos(filename):
    prefijo, _, resto = filename.partition("/")
    carpeta, _, archivo = resto.partition("/")
    if prefijo != "anonimizador" or carpeta not in CARPETAS_PUBLICAS or not archivo:
        abort(404)
    return send_from_directory(os.path.join(current_app.config["REPO_DIR"], carpeta), archivo)


def librerias_locales():
    """Rutas a las librerías descargadas con descargar_librerias.py. Si no están, la página usa el CDN."""
    vendor = os.path.join(current_app.config["REPO_DIR"], "vendor")
    necesarios = ["pdf.min.mjs", "pdf.worker.min.mjs", "tesseract.min.js", "worker.min.js",
                  "mammoth.browser.min.js", "tesseract-core/tesseract-core-simd-lstm.wasm.js",
                  "idioma/spa.traineddata.gz"]
    if not all(os.path.isfile(os.path.join(vendor, n)) for n in necesarios):
        return None
    ruta = lambda nombre: url_for("static", filename=f"anonimizador/vendor/{nombre}")
    return {
        "pdfjs": ruta("pdf.min.mjs"),
        "pdfjsWorker": ruta("pdf.worker.min.mjs"),
        "tesseract": ruta("tesseract.min.js"),
        "tesseractWorker": ruta("worker.min.js"),
        "tesseractCore": ruta("tesseract-core").rstrip("/"),
        "tesseractIdioma": ruta("idioma").rstrip("/"),
        "mammoth": ruta("mammoth.browser.min.js"),
    }
