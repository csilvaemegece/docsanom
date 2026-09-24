# SACA · Anonimizador (servidor Flask)

Módulo Flask del S.A.C.A. que entrega la página del anonimizador, con la misma estructura que el resto de los módulos: `create_app`, blueprint `main`, `wsgi.py` y Waitress.

**El servidor no recibe las causas.** El documento se lee, se limpia y se enmascara en el navegador de quien lo usa. El servidor solo entrega HTML, CSS y JavaScript: no tiene base de datos ni rutas que reciban archivos, y en sus registros solo aparecen peticiones GET a la página y a sus archivos.

## Requisitos

- Python 3.10 o superior.
- Conexión a internet **solo una vez**, para descargar las librerías (paso 3).

## Instalación en el servidor

```bash
git clone https://github.com/csilvaemegece/docsanom.git
cd docsanom/servidor
python -m venv .venv
.venv\Scripts\activate          # Linux: source .venv/bin/activate
pip install -r requirements.txt
python descargar_librerias.py
```

`descargar_librerias.py` guarda en `docsanom/vendor/` pdf.js, Tesseract.js (con su núcleo y el modelo de español) y mammoth, unos 22 MB en total. Verifica cada archivo con su SHA-256. Desde ese momento, la página los toma del servidor y los equipos de la corte no necesitan salida a internet.

Si el servidor no tiene internet, corre el script en otro equipo y copia la carpeta `vendor/` completa a `docsanom/vendor/`. Si falta algún archivo, la página vuelve a usar el CDN automáticamente.

## Ejecución

```bash
cd docsanom/servidor
python -m waitress --host=0.0.0.0 --port=5003 --threads=4 wsgi:app
```

Queda en `http://<servidor>:5003/`. El puerto 5003 es solo una sugerencia, para no chocar con Adultos Mayores (5002); usa el que corresponda. Abre ese puerto en el firewall del servidor.

No necesita HTTPS: no usa cámara ni otras funciones restringidas. El botón *Copiar* funciona igual sobre HTTP.

## Como servicio de Windows (NSSM)

Si los demás módulos del SACA corren como servicio con [NSSM](https://nssm.cc/):

```bat
nssm install SACA-Anonimizador "C:\ruta\docsanom\servidor\.venv\Scripts\python.exe" "-m waitress --host=0.0.0.0 --port=5003 --threads=4 wsgi:app"
nssm set SACA-Anonimizador AppDirectory "C:\ruta\docsanom\servidor"
nssm start SACA-Anonimizador
```

En Linux, el equivalente es un servicio de systemd con `WorkingDirectory=/ruta/docsanom/servidor` y `ExecStart=/ruta/docsanom/servidor/.venv/bin/python -m waitress --host=0.0.0.0 --port=5003 wsgi:app`.

## Detrás de un proxy (IIS, nginx) en una subruta

Para publicarlo como `https://saca.midominio/anonimizador/` en vez de usar un puerto propio, indícale el prefijo a Waitress. Así todas las URL de la página se generan con ese prefijo:

```bash
python -m waitress --host=127.0.0.1 --port=5003 --url-prefix=/anonimizador wsgi:app
```

## Actualizar

```bash
cd docsanom
git pull
cd servidor
python descargar_librerias.py   # solo descarga algo si cambió la versión de alguna librería
```

Después, reinicia el servicio. Los navegadores guardan los archivos en caché por una hora; con Ctrl+F5 se fuerza la versión nueva.

## Pruebas

```bash
cd docsanom/servidor
python -m unittest test_servidor -v
```

## Integrarlo dentro de otra app Flask del SACA

Si prefieres no tener un servicio aparte y agregarlo a una aplicación Flask existente, sigue [`integracion_saca/README.md`](../integracion_saca/README.md).
