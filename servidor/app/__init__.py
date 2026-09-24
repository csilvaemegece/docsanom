import mimetypes
import os

from flask import Flask
from jinja2 import ChoiceLoader, FileSystemLoader

# Windows suele no conocer estos tipos (o los toma del registro con valores incorrectos). Sin ellos,
# el navegador rechaza pdf.js (.mjs) por venir como text/plain.
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/wasm", ".wasm")


def create_app(config_object="config.Config"):
    # Sin carpeta static propia: los archivos del módulo se sirven desde el repositorio (ver routes.py).
    app = Flask(__name__, static_folder=None)
    app.config.from_object(config_object)

    # base.html está en servidor/app/templates; anonimizador.html es la misma plantilla que se entrega
    # para integrar en el SACA (integracion_saca/templates), así no hay dos copias.
    app.jinja_loader = ChoiceLoader([
        FileSystemLoader(os.path.join(os.path.dirname(__file__), "templates")),
        FileSystemLoader(os.path.join(app.config["REPO_DIR"], "integracion_saca", "templates")),
    ])

    from app.routes import bp as main_bp, estaticos
    app.register_blueprint(main_bp)
    # Mismo esquema de URL que dentro del SACA (static/anonimizador/...): url_for('static', ...)
    app.add_url_rule("/static/<path:filename>", endpoint="static", view_func=estaticos)

    @app.after_request
    def cabeceras_seguridad(respuesta):
        respuesta.headers.setdefault("X-Content-Type-Options", "nosniff")
        respuesta.headers.setdefault("Referrer-Policy", "no-referrer")
        respuesta.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        return respuesta

    return app
