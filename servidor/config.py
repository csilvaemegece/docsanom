import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    # Raíz del repositorio docsanom: de ahí se sirven css/, js/ y vendor/.
    REPO_DIR = os.environ.get("ANONIMIZADOR_REPO_DIR", os.path.dirname(BASE_DIR))
    # Los archivos estáticos se pueden cachear; al actualizar el módulo basta con recargar la página.
    SEND_FILE_MAX_AGE_DEFAULT = 3600
