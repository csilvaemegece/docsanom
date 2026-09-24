// Genera la plantilla Jinja del SACA (templates/anonimizador.html) a partir de index.html,
// para que el contenido del módulo no se desincronice. Uso:  node integracion_saca/generar.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(aqui, "..", "index.html"), "utf8");

const contenido = html.match(/<main class="content">\n([\s\S]*?)\n\s*<\/main>/)[1]
  .split("\n").map((l) => l.replace(/^ {8}/, "")).join("\n");
const aviso = html.match(/<div id="aviso"[^>]*><\/div>/)[0];
const scripts = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map((m) => m[1]);

const plantilla = `{# Generado por integracion_saca/generar.mjs a partir de index.html. No editar a mano. #}
{% extends "base.html" %}
{% block title %}Anonimizador · SACA{% endblock %}
{% block breadcrumb %}Anonimizador<span class="sep">›</span><span id="migas">Anonimizar causa</span>{% endblock %}

{% block content %}
<link rel="stylesheet" href="{{ url_for('static', filename='anonimizador/css/anonimizador.css') }}">

${contenido}

${aviso}
{% endblock %}

{% block scripts %}
{% if librerias_locales %}
<script>window.ANONIMIZADOR_LIBRERIAS = {{ librerias_locales|tojson }};</script>
{% endif %}
${scripts.map((s) => `<script src="{{ url_for('static', filename='anonimizador/js/${s}') }}"></script>`).join("\n")}
{% endblock %}
`;

fs.mkdirSync(path.join(aqui, "templates"), { recursive: true });
fs.writeFileSync(path.join(aqui, "templates", "anonimizador.html"), plantilla);
console.log("Generado integracion_saca/templates/anonimizador.html");
