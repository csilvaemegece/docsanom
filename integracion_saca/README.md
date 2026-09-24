# Integración en el S.A.C.A.

La página independiente (`index.html`) ya usa la estructura y los estilos del SACA: barra lateral, barra superior, `.panel`, `.btn`, `.flash`, `.table-wrap`, etc. Para llevarla al SACA (Flask) no hay que rediseñar nada, solo copiar archivos y registrar la ruta.

Como todo el procesamiento ocurre en el navegador, el servidor solo entrega la página: no recibe el documento ni la tabla de marcadores.

## 1. Copiar archivos

| Desde este repositorio | Hacia el SACA |
|---|---|
| `css/anonimizador.css` | `app/static/anonimizador/css/anonimizador.css` |
| `js/*.js` | `app/static/anonimizador/js/` |
| `integracion_saca/templates/anonimizador.html` | `app/templates/anonimizador.html` |

`css/saca.css` **no** se copia: es una copia del `style.css` del SACA y ahí se usa el original.

La plantilla se genera desde `index.html`. Si cambias la página, vuelve a generarla:

```bash
node integracion_saca/generar.mjs
```

## 2. Registrar la ruta (`app/routes.py`)

```python
@bp.route("/anonimizador")
def anonimizador():
    return render_template("anonimizador.html", active_page="anonimizador")
```

(Usa el nombre del blueprint del SACA; en el módulo de Adultos Mayores es `main`.)

## 3. Agregar el menú (`app/templates/base.html`)

Dentro de `<nav class="side-nav">`. El atributo `data-vista` permite que la página marque cuál de las dos vistas está activa:

```html
<div class="nav-section-label">ANONIMIZADOR</div>

<a class="nav-item" href="{{ url_for('main.anonimizador') }}#anonimizar" data-vista="anonimizar">
  <span class="nav-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12h6"/>
    </svg>
  </span>
  <span>Anonimizar causa</span>
</a>

<a class="nav-item" href="{{ url_for('main.anonimizador') }}#restaurar" data-vista="restaurar">
  <span class="nav-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>
    </svg>
  </span>
  <span>Restaurar respuesta</span>
</a>
```

## Notas

- Las dos vistas (*Anonimizar causa* y *Restaurar respuesta*) están en la misma página a propósito. La tabla de marcadores vive en la memoria del navegador, y si fueran dos páginas se perdería al cambiar de una a otra.
- La página descarga pdf.js, Tesseract.js, mammoth y el modelo de español del OCR desde cdnjs y jsdelivr. Si los equipos de la corte no tienen salida a internet, hay que servir esas librerías desde `static/` y cambiar las URL al inicio de `js/extraccion.js`.
