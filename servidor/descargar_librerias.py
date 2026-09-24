"""Descarga a vendor/ las librerías que la página usa (lectura de PDF, OCR y Word), para que el servidor
las entregue él mismo y los equipos no necesiten salida a internet.

Cada archivo se verifica contra su SHA-256: si el CDN entrega algo distinto, no se guarda.
Uso (desde la carpeta servidor/):  python descargar_librerias.py
"""
import hashlib
import os
import sys
import urllib.request

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR = os.path.join(REPO_DIR, "vendor")

# Mismas versiones que js/extraccion.js. Si se actualiza una, hay que actualizar su URL y su hash.
ARCHIVOS = [
    ("pdf.min.mjs", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs",
     "27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c"),
    ("pdf.worker.min.mjs", "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs",
     "1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36"),
    ("tesseract.min.js", "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
     "a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8"),
    ("worker.min.js", "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
     "aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc"),
    # Tesseract elige una de estas variantes según el navegador (SIMD o no).
    ("tesseract-core/tesseract-core.wasm.js",
     "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core.wasm.js",
     "2b8c8c92b8788807061fb4bb16c5acdf000c149e100255f879f78d2c58ca9969"),
    ("tesseract-core/tesseract-core-simd.wasm.js",
     "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd.wasm.js",
     "63f232c4f7a97b04e52eb940202700b2c6239783a75d0ff0553274fac530cd5c"),
    ("tesseract-core/tesseract-core-lstm.wasm.js",
     "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js",
     "8f04aa0cc81e7bde33f80e92fa01a7a665f0b4884d098acf5de9c7104a11dfaa"),
    ("tesseract-core/tesseract-core-simd-lstm.wasm.js",
     "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js",
     "ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf"),
    ("idioma/spa.traineddata.gz",
     "https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz",
     "40be52f97b5d4eb7460073dc1f94cd546b27150333c0bf854ed7e7132db6bceb"),
    ("mammoth.browser.min.js", "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js",
     "deb07bf230d1cb3e190bc5adc6743f35c6531b6571d1e5469b24f452a7f0f4ab"),
]


def sha256(datos):
    return hashlib.sha256(datos).hexdigest()


def main():
    errores = 0
    for nombre, url, esperado in ARCHIVOS:
        destino = os.path.join(VENDOR, *nombre.split("/"))
        if os.path.isfile(destino):
            with open(destino, "rb") as f:
                if sha256(f.read()) == esperado:
                    print(f"  ya estaba  {nombre}")
                    continue
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                datos = r.read()
        except Exception as e:  # noqa: BLE001 - se informa y se sigue con el resto
            print(f"  ERROR      {nombre}: {e}")
            errores += 1
            continue
        if sha256(datos) != esperado:
            print(f"  ERROR      {nombre}: el hash no coincide, no se guarda")
            errores += 1
            continue
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        with open(destino, "wb") as f:
            f.write(datos)
        print(f"  descargado {nombre} ({len(datos) / 1e6:.1f} MB)")

    if errores:
        print(f"\n{errores} archivo(s) con error. La página seguirá usando el CDN hasta que estén todos.")
        sys.exit(1)
    print(f"\nListo: las librerías quedaron en {VENDOR}")


if __name__ == "__main__":
    main()
