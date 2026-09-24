# Anonimizador de causas

Página web para **enmascarar datos personales de una causa judicial antes de enviarla a una IA** y luego **restaurarlos en la respuesta**.

```
Causa original ──► enmascarar (en tu navegador) ──► texto con [PERSONA_1], [RUT_1]… ──► IA
                        │                                                                │
                  tabla de tokens (queda contigo)                                       ▼
Respuesta final ◄── restaurar (en tu navegador) ◄──────────────── resumen con [PERSONA_1]…
```

**Todo el procesamiento ocurre en el navegador.** El documento no se sube a ningún servidor; solo se descargan las librerías de lectura de PDF (pdf.js), OCR (Tesseract.js) y Word (mammoth), y el modelo de idioma español del OCR.

## Uso

1. Abre `index.html` (con doble clic o desde GitHub Pages) y arrastra a la página el PDF, DOCX o TXT de la causa.
2. Revisa lo enmascarado:
   - Haz clic en un dato resaltado para dejar de enmascararlo.
   - En **Posibles fugas**, enmascara lo que haya quedado visible o agrega datos a mano.
3. Copia el texto para la IA. Incluye instrucciones para que la IA conserve los marcadores y un glosario de roles, por ejemplo `[PERSONA_2]: abogado recurrente`.
4. **Descarga la tabla de tokens.** Contiene los datos reales y es necesaria para restaurar; si recargas la página, se pierde.
5. Pega la respuesta de la IA en el paso 4 para recuperar los nombres reales. La página avisa si la IA devolvió marcadores que no existen.

## Qué detecta

| Dato | Cómo |
|---|---|
| Partes y abogados | Tabla *Litigantes* de la carátula del expediente del PJUD (incluye el titular de una EIRL) |
| RUT | Formato con dígito verificador; también sin guion, pegado a otros dígitos o con comas del OCR. Los RUT 60/61 (organismos públicos) no se enmascaran |
| Personas | Nombres de pila frecuentes y palabras que anteceden a un nombre (*don*, *abogado*, *testigo*…). Cada persona encontrada se busca después en todo el documento |
| Empresas | Sufijos societarios (LIMITADA, SPA, EIRL…) o giros al inicio (SOCIEDAD, CONSTRUCTORA…) |
| Direcciones | Calle / avenida / pasaje + número, y el campo `DOMICILIO:` de los formularios |
| Correos y teléfonos | Formatos habituales, incluidos correos donde el OCR no leyó la `@` |

Las variantes de una misma entidad (tildes, mayúsculas, saltos de línea, errores del OCR) reciben el mismo token, para que la IA entienda que se trata de la misma persona.

## Limitaciones

- **La detección no es perfecta.** Revisa siempre el texto y la pestaña *Posibles fugas* antes de enviarlo.
- **Se enmascara de más.** A veces caen calles con nombre de persona ("Gabriela Mistral") o autores citados.
- **La escritura a mano no se lee.** El OCR no reconoce texto manuscrito (actas, firmas).
- **Los datos que permiten ubicar la causa no se enmascaran:** ROL, tribunal, números de expediente, fechas y montos. Con ellos se puede encontrar la causa en el PJUD.
- **El OCR necesita la pestaña visible.** Tarda unos segundos por página y el navegador lo pausa si cambias de pestaña.

## Publicar con GitHub Pages

*Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`*. Queda en `https://csilvaemegece.github.io/docsanom/`.

También funciona sin publicar: descarga el repositorio y abre `index.html` con doble clic. Hace falta conexión a internet la primera vez, para descargar las librerías y el modelo del OCR.

## Estructura

- `index.html`, `css/estilos.css`: interfaz.
- `js/app.js`: lógica de la interfaz.
- `js/extraccion.js`: lectura de PDF (con OCR), DOCX y TXT.
- `js/anonimizador.js`: motor de seudonimización, sin dependencias del navegador.
- `pruebas/`: pruebas del motor con una causa ficticia.

```bash
node --test pruebas/anonimizador.test.mjs
```

> No subas causas reales ni tablas de tokens a este repositorio. El `.gitignore` excluye PDF, DOCX y JSON por precaución.
