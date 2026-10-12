"use strict";
// Libreta de Kimchi. Los datos viven en el teléfono (localStorage) y se sincronizan
// con data.json en un repo privado de GitHub, así Marco y Tania ven lo mismo.
// Las fotos van como archivos en fotos/ del mismo repo y se guardan en caché en el teléfono.

const REPO = { owner: "8pelao", repo: "kimchi-datos", path: "data.json" };
const GUIA = "https://claude.ai/artifact/8p7HdoXzi1xiGj5hi6So6h";
const K = { datos: "kimchi.datos", token: "kimchi.token", sync: "kimchi.sync", pend: "kimchi.fotosPendientes" };
const VERSION = "1.1";
const FOTOS_CACHE = "kimchi-fotos";

const TIPOS = {
  consulta: "Consulta", vacuna: "Vacuna", desparasitacion: "Desparasitación", sintoma: "Síntoma",
  remedio: "Remedio", comida: "Comida", nota: "Nota", hito: "Hito",
};
const TIPOS_PL = {
  sintoma: "Síntomas", consulta: "Consultas", comida: "Comida", remedio: "Remedios",
  vacuna: "Vacunas", desparasitacion: "Desparasitaciones", nota: "Notas", hito: "Hitos",
};
const ORDEN_TIPOS = Object.keys(TIPOS_PL);
const PROXIMA = { consulta: "Próximo control", vacuna: "Próxima dosis", desparasitacion: "Próxima desparasitación", remedio: "Fin del tratamiento" };
const TIPOS_CONTACTO = { vet: "Veterinaria", guardia: "Guardia 24 h", otro: "Otro" };
const COLS = ["contactos", "pesos", "eventos", "recordatorios", "fotos"];
const DIA = 86400000;

// ---------- utilidades
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const ahora = () => new Date().toISOString();
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hoyISO = () => iso(new Date());
const aFecha = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const sumarDias = (s, n) => { const d = aFecha(s); d.setDate(d.getDate() + n); return iso(d); };
const diasEntre = (a, b) => Math.round((aFecha(b) - aFecha(a)) / DIA);
const fCorta = s => aFecha(s).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
const fLarga = s => aFecha(s).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
const fNum = s => aFecha(s).toLocaleDateString("es-AR");
const kgTxt = n => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 }) + " kg";
const plural = (n, uno, varios) => n + " " + (Math.abs(n) === 1 ? uno : varios);
function guardar(k, v) { try { localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch (e) {} }
function leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function borrarLS(k) { try { localStorage.removeItem(k); } catch (e) {} }

function edad(nac, hasta = hoyISO()) {
  const n = aFecha(nac), h = aFecha(hasta), dias = diasEntre(nac, hasta);
  const meses = (h.getFullYear() - n.getFullYear()) * 12 + h.getMonth() - n.getMonth() - (h.getDate() < n.getDate() ? 1 : 0);
  return { dias, meses, semanas: Math.floor(dias / 7), resto: dias % 7 };
}
function edadTexto(nac, hasta) {
  const e = edad(nac, hasta);
  if (e.dias < 0) return "";
  if (e.meses < 2) return plural(e.dias, "día", "días");
  if (e.meses < 24) return e.meses + " meses";
  return Math.floor(e.meses / 12) + " años";
}
function cuando(fecha) {
  const d = diasEntre(hoyISO(), fecha);
  if (d === 0) return "hoy";
  if (d === 1) return "mañana";
  if (d === -1) return "ayer";
  return d > 0 ? "en " + plural(d, "día", "días") : "hace " + plural(-d, "día", "días");
}
function rangoFechas(evs) {
  const fs = evs.map(e => e.fecha).sort();
  const a = fs[0], b = fs[fs.length - 1];
  return a === b ? fCorta(a) : `${fCorta(a)} – ${fCorta(b)}`;
}

// ---------- datos
function perfilBase() {
  return { nombre: "Kimchi", nacimiento: "2026-08-25", raza: "Salchicha (dachshund)", sexo: "Hembra", color: "",
    chip: "", alimento: "", kcalKg: 4000, pesoAdulto: 5, alergias: "", notas: "", fotoId: "", updatedAt: "" };
}
const vacio = () => ({ version: 1, perfil: perfilBase(), contactos: [], pesos: [], eventos: [], recordatorios: [], fotos: [] });
let datos = (() => {
  try { const d = JSON.parse(leer(K.datos)); if (d && d.perfil) return { ...vacio(), ...d }; } catch (e) {}
  return vacio();
})();
const vivos = c => (datos[c] || []).filter(x => !x.deleted);
const porFechaDesc = (a, b) => b.fecha.localeCompare(a.fecha) || (b.updatedAt || "").localeCompare(a.updatedAt || "");
const ultimoPeso = () => vivos("pesos").sort(porFechaDesc)[0];

function cambiar(col, item) {
  item.updatedAt = ahora();
  const i = datos[col].findIndex(x => x.id === item.id);
  if (i >= 0) datos[col][i] = item; else datos[col].push(item);
}
function borrar(col, id) {
  const x = datos[col].find(x => x.id === id);
  if (x) { x.deleted = true; x.updatedAt = ahora(); }
}
function persistir() { guardar(K.datos, datos); render(); programarSync(); }

// Une dos versiones: por cada registro gana la edición más reciente. Lo borrado queda marcado.
// Lo que esta versión no conoce se conserva tal cual.
function mezclar(a, b) {
  const pa = a.perfil || {}, pb = b.perfil || {};
  const out = { ...b, ...a, version: 1, perfil: (pa.updatedAt || "") >= (pb.updatedAt || "") ? pa : pb };
  for (const c of COLS) {
    const m = new Map();
    for (const x of [...(a[c] || []), ...(b[c] || [])]) {
      const y = m.get(x.id);
      if (!y || (x.updatedAt || "") > (y.updatedAt || "")) m.set(x.id, x);
    }
    out[c] = [...m.values()].sort((x, y) => x.id.localeCompare(y.id));
  }
  return out;
}

function racion() {
  const p = datos.perfil, w = ultimoPeso()?.kg, e = edad(p.nacimiento);
  if (!w || !p.kcalKg) return null;
  if (e.meses >= 12) return { adulta: true };
  const comidas = e.meses < 3 ? 4 : e.meses < 6 ? 3 : 2;
  const prop = Math.min(w / (p.pesoAdulto || 5), 1);
  // Energía para cachorros del NRC (2006)
  const kcal = 130 * Math.pow(w, 0.75) * 3.2 * (Math.exp(-0.87 * prop) - 0.1);
  const g = Math.round(kcal / p.kcalKg * 1000);
  return { kcal: Math.round(kcal), g, comidas, porComida: Math.round(g / comidas) };
}

// ---------- sincronización con GitHub
let token = leer(K.token) || "";
let syncEstado = JSON.parse(leer(K.sync) || "null") || { estado: token ? "pendiente" : "sin-token" };
let syncEnCurso = null, syncOtraVez = false, syncTimer = 0;

function bytesAb64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const textoAb64 = t => bytesAb64(new TextEncoder().encode(t));
function b64aTexto(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
function api(method, body, path = REPO.path, accept = "application/vnd.github+json") {
  return fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${path}`, {
    method, cache: "no-store",
    headers: { Authorization: "Bearer " + token, Accept: accept, "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
function ponerEstado(estado, mensaje) {
  syncEstado = { estado, mensaje: mensaje || "", cuando: estado === "ok" ? ahora() : syncEstado.cuando };
  guardar(K.sync, syncEstado);
  pintarSync();
}
function programarSync() { clearTimeout(syncTimer); syncTimer = setTimeout(sincronizar, 800); }

async function sincronizar() {
  if (!token) return ponerEstado("sin-token");
  if (!navigator.onLine) return ponerEstado("sin-conexion");
  if (syncEnCurso) { syncOtraVez = true; return syncEnCurso; }
  ponerEstado("sincronizando");
  syncEnCurso = (async () => {
    await subirFotosPendientes();
    for (let intento = 0; intento < 4; intento++) {
      const r = await api("GET");
      let remoto = null, sha;
      if (r.status === 200) { const j = await r.json(); sha = j.sha; remoto = JSON.parse(b64aTexto(j.content)); }
      else if (r.status === 401) throw new Error("La clave de acceso venció o es incorrecta.");
      else if (r.status === 403) throw new Error("La clave no tiene permiso para leer los datos.");
      else if (r.status !== 404) throw new Error("GitHub respondió " + r.status + ".");
      const mezcla = remoto ? mezclar(datos, remoto) : mezclar(datos, {});
      const igual = remoto && JSON.stringify(mezcla) === JSON.stringify(mezclar(remoto, {}));
      datos = mezcla; guardar(K.datos, datos); render();
      if (igual) return;
      const put = await api("PUT", { message: "Actualizar datos de " + (datos.perfil.nombre || "Kimchi"),
        content: textoAb64(JSON.stringify(mezcla, null, 1)), ...(sha ? { sha } : {}) });
      if (put.ok) return;
      if (put.status === 409 || put.status === 422) continue; // el otro teléfono guardó justo antes: se vuelve a unir
      if (put.status === 404) throw new Error("La clave no tiene acceso al repositorio " + REPO.repo + ".");
      if (put.status === 401) throw new Error("La clave de acceso venció o es incorrecta.");
      if (put.status === 403) throw new Error("La clave no tiene permiso de escritura.");
      throw new Error("GitHub respondió " + put.status + " al guardar.");
    }
    throw new Error("No se pudo guardar después de varios intentos.");
  })();
  try { await syncEnCurso; ponerEstado("ok"); }
  catch (e) { ponerEstado(navigator.onLine ? "error" : "sin-conexion", e.message === "Failed to fetch" ? "No hay conexión con GitHub." : e.message); }
  finally {
    syncEnCurso = null;
    if (syncOtraVez) { syncOtraVez = false; programarSync(); }
  }
}

function pintarSync() {
  const p = $("#syncPunto"), t = $("#syncTxt");
  const e = syncEstado.estado;
  p.className = "punto" + (e === "ok" ? " ok" : e === "error" ? " err" : e === "sincronizando" ? " girando" : "");
  t.textContent = {
    "ok": "Al día", "sincronizando": "Sincronizando", "sin-conexion": "Sin conexión",
    "sin-token": "Sin conectar", "error": "Error", "pendiente": "Sincronizar",
  }[e] || "Sincronizar";
}

// ---------- fotos
// Una foto nueva queda en la caché del teléfono y en «pendientes» hasta que se sube al repo;
// recién ahí entra en datos.fotos, así el otro teléfono nunca pide un archivo que no existe.
let fotosPendientes = JSON.parse(leer(K.pend) || "[]");
const urlsFotos = new Map();
const claveFoto = id => "foto-cache/" + id;
const rutaFoto = id => "fotos/" + id + ".jpg";
const guardarPendientes = () => guardar(K.pend, fotosPendientes);

function todasLasFotos() {
  const subidas = vivos("fotos").map(f => ({ ...f, pendiente: false }));
  const ids = new Set(subidas.map(f => f.id));
  const pend = fotosPendientes.filter(p => !ids.has(p.id)).map(p => ({ ...p, pendiente: true }));
  return [...subidas, ...pend].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
}
function fotoPerfilId() {
  const pend = fotosPendientes.filter(p => p.perfil);
  return pend.length ? pend[pend.length - 1].id : datos.perfil.fotoId || "";
}

async function comprimir(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return new Promise(res => cv.toBlob(res, "image/jpeg", 0.82));
}

async function urlFoto(id) {
  if (urlsFotos.has(id)) return urlsFotos.get(id);
  let blob = null;
  try {
    const c = await caches.open(FOTOS_CACHE);
    const r = await c.match(claveFoto(id));
    if (r) blob = await r.blob();
    else if (token && navigator.onLine && vivos("fotos").some(f => f.id === id)) {
      const resp = await api("GET", null, rutaFoto(id), "application/vnd.github.raw+json");
      if (!resp.ok) return null;
      blob = await resp.blob();
      await c.put(claveFoto(id), new Response(blob, { headers: { "Content-Type": "image/jpeg" } }));
    }
  } catch (e) { return null; }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlsFotos.set(id, url);
  return url;
}

function pintarFotos() {
  document.querySelectorAll("img[data-foto]").forEach(async img => {
    const url = await urlFoto(img.dataset.foto);
    if (url && img.isConnected) { img.src = url; img.closest(".foto-marco")?.classList.add("cargada"); }
  });
}

async function subirFotosPendientes() {
  for (const p of [...fotosPendientes]) {
    const c = await caches.open(FOTOS_CACHE);
    const r = await c.match(claveFoto(p.id));
    if (!r) { fotosPendientes = fotosPendientes.filter(x => x.id !== p.id); guardarPendientes(); continue; }
    const bytes = new Uint8Array(await (await r.blob()).arrayBuffer());
    const put = await api("PUT", { message: "Foto de " + (datos.perfil.nombre || "Kimchi"), content: bytesAb64(bytes) }, rutaFoto(p.id));
    if (!put.ok && put.status !== 422) throw new Error("No se pudo subir una foto (GitHub respondió " + put.status + ").");
    cambiar("fotos", { id: p.id, fecha: p.fecha, nota: p.nota || "" }); // 422 = ya estaba subida
    if (p.perfil) datos.perfil = { ...datos.perfil, fotoId: p.id, updatedAt: ahora() };
    fotosPendientes = fotosPendientes.filter(x => x.id !== p.id);
    guardarPendientes(); guardar(K.datos, datos);
  }
}

async function borrarArchivoFoto(id) {
  try {
    const r = await api("GET", null, rutaFoto(id));
    if (r.ok) { const j = await r.json(); await api("DELETE", { message: "Borrar foto", sha: j.sha }, rutaFoto(id)); }
  } catch (e) {}
}

// ---------- navegación
let vista = new URLSearchParams(location.search).get("vista") || "inicio";
let filtro = "todos", modoHist = "resumen";
function irA(v, apilar = true) {
  if (v === vista) { scrollTo(0, 0); return; }
  vista = v;
  if (apilar) history.pushState({ vista: v }, "");
  render();
  scrollTo(0, 0);
}
addEventListener("popstate", e => {
  const h = $("#hoja");
  if (h.open) { h.close(); return; }
  vista = e.state?.vista || "inicio";
  render();
});

// ---------- pantallas
function render() {
  const p = datos.perfil;
  $("#nombre").textContent = p.nombre || "Kimchi";
  const e = edad(p.nacimiento);
  $("#edad").textContent = e.dias >= 0
    ? edadTexto(p.nacimiento) + (e.meses < 4 ? " · " + e.semanas + " sem" + (e.resto ? " y " + plural(e.resto, "día", "días") : "") : "")
    : "";
  const fid = fotoPerfilId(), av = $("#avatar");
  av.hidden = !fid;
  if (fid && av.dataset.foto !== fid) { av.dataset.foto = fid; av.removeAttribute("src"); }
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-current", b.dataset.tab === vista ? "page" : "false"));
  const pant = { inicio, peso, historial, avisos, ficha, vet }[vista] || inicio;
  $("#vista").innerHTML = pant();
  pintarSync();
  pintarFotos();
}

function tarjetaRacion() {
  const r = racion(), p = datos.perfil;
  if (!r) return `<div class="card"><span class="etiqueta">Ración</span><p class="vacio">Anotá su peso y el alimento (en Ficha) para calcular los gramos del día.</p></div>`;
  if (r.adulta) return `<div class="card"><span class="etiqueta">Ración</span><p>Ya es adulta: la ración sale de la tabla del alimento adulto.</p></div>`;
  return `<div class="card">
    <span class="etiqueta">Ración de hoy${p.alimento ? " · " + esc(p.alimento) : ""}</span>
    <div class="grande num">${r.g} g <small>por día</small></div>
    <p class="num">${r.comidas} comidas de ${r.porComida} g · ≈ ${r.kcal} kcal</p>
    <p class="small muted">Gramos en seco, calculados con su último peso (${kgTxt(ultimoPeso().kg)}). Si el vet indicó otra cosa, manda lo del vet.</p>
  </div>`;
}

function itemAviso(r) {
  const d = diasEntre(hoyISO(), r.fecha);
  const clase = r.hecho ? "hecho" : d < 0 ? "atrasado" : d === 0 ? "hoy-aviso" : "";
  return `<div class="item ${clase}">
    <div class="item-cuerpo">
      <span class="item-meta num">${fCorta(r.fecha)} · ${cuando(r.fecha)}</span>
      <span class="item-titulo">${esc(r.titulo)}</span>
      ${r.detalle ? `<span class="item-detalle">${esc(r.detalle)}</span>` : ""}
      <div class="fila no-print" style="margin-top:6px">
        <button class="btn chico" data-accion="hecho" data-id="${r.id}">${r.hecho ? "Desmarcar" : "Hecho"}</button>
        ${r.hecho ? "" : `<a class="btn chico" href="${linkCalendario(r)}" target="_blank" rel="noopener">Al calendario</a>`}
      </div>
    </div>
    <button class="editar" data-accion="editar-aviso" data-id="${r.id}">Editar</button>
  </div>`;
}

// Un registro en una sola línea; al tocarlo se despliega el detalle.
function lineaEvento(ev, conTipo = true) {
  return `<details class="linea">
    <summary>${conTipo ? `<span class="pill t-${ev.tipo}">${TIPOS[ev.tipo] || "Nota"}</span>` : ""}<span class="linea-fecha num">${fCorta(ev.fecha)}</span><span class="linea-titulo">${esc(ev.titulo)}</span></summary>
    <div class="linea-cuerpo">
      ${ev.detalle ? `<p class="item-detalle">${esc(ev.detalle)}</p>` : ""}
      ${ev.proxima ? `<p class="item-meta">${PROXIMA[ev.tipo] || "Próxima"}: ${fCorta(ev.proxima)}</p>` : ""}
      <button class="editar" style="justify-self:start;padding-left:0" data-accion="editar-evento" data-id="${ev.id}">Editar</button>
    </div>
  </details>`;
}

function pendientes() {
  return vivos("recordatorios").filter(r => !r.hecho).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function inicio() {
  const ult = ultimoPeso();
  const prox = pendientes().slice(0, 3);
  const ult5 = vivos("eventos").sort(porFechaDesc).slice(0, 5);
  const vet = vivos("contactos").find(c => c.tipo === "vet");
  const hacePeso = ult ? diasEntre(ult.fecha, hoyISO()) : null;
  return `
    ${instalable && !enApp() ? `<div class="aviso-banda fila"><span style="flex:1">Instalá la app para abrirla desde la pantalla de inicio.</span><button class="btn chico primario" data-accion="instalar">Instalar</button></div>` : ""}
    ${syncEstado.estado === "sin-token" ? `<div class="aviso-banda">Los datos están solo en este teléfono. <button class="editar" style="padding:0" data-accion="ir" data-vista="ficha">Conectá la sincronización</button> para compartirlos con Tania.</div>` : ""}
    ${syncEstado.estado === "error" ? `<div class="aviso-banda">No se pudo sincronizar: ${esc(syncEstado.mensaje)}</div>` : ""}
    <div class="card">
      <span class="etiqueta">Agregar</span>
      <div class="rapidos">
        <button class="rapido" data-accion="nuevo-peso"><i class="t-peso"></i>Peso</button>
        <button class="rapido" data-accion="agregar-foto"><i class="t-comida"></i>Foto</button>
        ${["sintoma", "consulta", "vacuna", "desparasitacion", "remedio", "comida", "nota"].map(t =>
          `<button class="rapido" data-accion="nuevo-evento" data-tipo="${t}"><i class="t-${t}"></i>${t === "desparasitacion" ? "Desparasitar" : TIPOS[t]}</button>`).join("")}
        <button class="rapido" data-accion="nuevo-aviso"><i class="t-hito"></i>Aviso</button>
      </div>
    </div>
    <div class="card">
      <div class="entre"><span class="etiqueta">Próximos avisos</span><button class="editar" data-accion="ir" data-vista="avisos">Ver todos</button></div>
      ${prox.length ? `<div class="lista">${prox.map(itemAviso).join("")}</div>` : `<p class="vacio">No hay avisos pendientes.</p>`}
    </div>
    <div class="card">
      <div class="entre"><span class="etiqueta">Peso</span><button class="editar" data-accion="ir" data-vista="peso">Ver crecimiento</button></div>
      ${ult ? `<div class="grande num">${kgTxt(ult.kg)}</div><p class="small muted">${fLarga(ult.fecha)} · ${cuando(ult.fecha)}</p>` : `<p class="vacio">Todavía no hay pesos anotados.</p>`}
      ${hacePeso !== null && hacePeso >= 7 ? `<p class="aviso-banda">Pasó una semana: toca pesarla.</p>` : ""}
    </div>
    ${tarjetaRacion()}
    <div class="card">
      <div class="entre"><span class="etiqueta">Últimos registros</span><button class="editar" data-accion="ir" data-vista="historial">Historial</button></div>
      ${ult5.length ? `<div class="lista">${ult5.map(e => lineaEvento(e)).join("")}</div>` : `<p class="vacio">Acá van a aparecer las consultas, síntomas y notas.</p>`}
    </div>
    <button class="btn primario ancho" data-accion="ir" data-vista="vet">Resumen para el veterinario</button>
    ${vet && vet.telefono ? `<a class="btn ancho" href="tel:${esc(vet.telefono.replace(/[^\d+]/g, ""))}">Llamar a ${esc(vet.nombre || "la veterinaria")}</a>` : ""}
  `;
}

function grafico(pesos, nac) {
  const pts = pesos.map(p => ({ x: diasEntre(nac, p.fecha), y: p.kg })).sort((a, b) => a.x - b.x);
  const W = 340, H = 190, L = 40, R = 14, T = 14, B = 30;
  const xMin = Math.max(0, Math.min(...pts.map(p => p.x)) - 7);
  const xMax = Math.max(xMin + 35, Math.max(...pts.map(p => p.x)) + 7);
  const yTop = Math.max(1, Math.max(...pts.map(p => p.y)) * 1.3);
  const paso = yTop <= 2 ? 0.5 : yTop <= 5 ? 1 : 2;
  const yMax = Math.ceil(yTop / paso) * paso;
  const sx = x => L + (x - xMin) / (xMax - xMin) * (W - L - R);
  const sy = y => T + (1 - y / yMax) * (H - T - B);
  let ejes = "";
  for (let y = 0; y <= yMax + 1e-9; y += paso) {
    ejes += `<line x1="${L}" x2="${W - R}" y1="${sy(y)}" y2="${sy(y)}" stroke="var(--line)"/>
      <text x="${L - 6}" y="${sy(y) + 4}" text-anchor="end">${y.toLocaleString("es-AR")}</text>`;
  }
  const pasoX = (xMax - xMin) > 120 ? 28 : 7;
  for (let x = Math.ceil(xMin / pasoX) * pasoX; x <= xMax; x += pasoX) {
    ejes += `<text x="${sx(x)}" y="${H - 10}" text-anchor="middle">${pasoX === 28 ? Math.round(x / 30.4) + " m" : Math.round(x / 7) + " sem"}</text>`;
  }
  const linea = pts.map(p => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const u = pts[pts.length - 1];
  return `<div class="grafico"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva de peso por edad">
    ${ejes}
    <polyline points="${linea}" fill="none" stroke="var(--tan)" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map(p => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3.5" fill="var(--tan)"/>`).join("")}
    <circle cx="${sx(u.x)}" cy="${sy(u.y)}" r="6" fill="var(--card)" stroke="var(--tan)" stroke-width="3"/>
  </svg></div>`;
}

function galeria() {
  const fotos = todasLasFotos(), nac = datos.perfil.nacimiento;
  return `<div class="card">
    <div class="entre"><span class="etiqueta">Fotos${fotos.length ? " (" + fotos.length + ")" : ""}</span>${fotos.length ? `<span class="small muted">de chiquita a hoy</span>` : ""}</div>
    ${fotos.length ? `<div class="galeria">${fotos.map(f => `<button class="foto-marco" data-accion="ver-foto" data-id="${f.id}" aria-label="Foto del ${fLarga(f.fecha)}">
        <img data-foto="${f.id}" alt="">
        <span class="foto-pie num">${edadTexto(nac, f.fecha) || fCorta(f.fecha)}${f.pendiente ? " · sin subir" : ""}</span>
      </button>`).join("")}</div>`
      : `<p class="vacio">Sumá fotos para ver cómo va creciendo. Cada foto queda con la edad que tenía.</p>`}
    <button class="btn ancho" data-accion="agregar-foto">Agregar foto</button>
  </div>`;
}

function peso() {
  const lista = vivos("pesos").sort(porFechaDesc);
  const nac = datos.perfil.nacimiento;
  const [u, a] = lista;
  let dif = "";
  if (u && a) {
    const d = u.kg - a.kg, dias = diasEntre(a.fecha, u.fecha);
    dif = `${d >= 0 ? "+" : "−"}${Math.abs(d).toLocaleString("es-AR", { maximumFractionDigits: 2 })} kg en ${plural(dias, "día", "días")}`;
  }
  return `
    <div class="card">
      <span class="etiqueta">Último peso</span>
      ${u ? `<div class="grande num">${kgTxt(u.kg)}</div><p class="small muted num">${fLarga(u.fecha)}${dif ? " · " + dif : ""}</p>` : `<p class="vacio">Anotá el primer peso.</p>`}
      ${lista.length ? grafico(lista, nac) : ""}
      <button class="btn primario ancho" data-accion="nuevo-peso">Anotar peso</button>
    </div>
    ${galeria()}
    ${tarjetaRacion()}
    <div class="card">
      <span class="etiqueta">Registro de peso</span>
      ${lista.length ? `<div class="lista">${lista.map(p => `<div class="item">
        <div class="item-cuerpo"><span class="item-titulo num">${kgTxt(p.kg)}</span>
        <span class="item-meta num">${fLarga(p.fecha)} · ${edadTexto(nac, p.fecha)}</span>
        ${p.nota ? `<span class="item-detalle">${esc(p.nota)}</span>` : ""}</div>
        <button class="editar" data-accion="editar-peso" data-id="${p.id}">Editar</button></div>`).join("")}</div>` : `<p class="vacio">Sin pesos todavía.</p>`}
      <p class="small muted">Pesala una vez por semana, a la misma hora y antes de comer: balanza de cocina con un bol, o pesarse con ella en brazos y restar.</p>
    </div>`;
}

function historial() {
  const todos = vivos("eventos").sort(porFechaDesc);
  const tipos = ORDEN_TIPOS.filter(t => todos.some(e => e.tipo === t));
  const selector = `<div class="segmentos" role="group" aria-label="Vista">
    <button data-accion="modo-hist" data-modo="resumen" aria-pressed="${modoHist === "resumen"}">Resumen</button>
    <button data-accion="modo-hist" data-modo="todo" aria-pressed="${modoHist === "todo"}">Todo</button>
  </div>`;
  const agregar = `<button class="btn primario ancho" data-accion="nuevo-evento" data-tipo="nota">Agregar registro</button>`;
  if (!todos.length) return agregar + `<div class="card"><p class="vacio">Todavía no hay registros.</p></div>`;

  if (modoHist === "resumen") {
    return agregar + selector + tipos.map(t => {
      const evs = todos.filter(e => e.tipo === t);
      return `<div class="card">
        <div class="entre">
          <span class="fila" style="gap:8px"><span class="pill t-${t}">${TIPOS_PL[t]}</span><span class="small muted num">${plural(evs.length, "registro", "registros")} · ${rangoFechas(evs)}</span></span>
          ${evs.length > 3 ? `<button class="editar" data-accion="ver-tipo" data-tipo="${t}">Ver ${evs.length}</button>` : ""}
        </div>
        <div class="lista">${evs.slice(0, 3).map(e => lineaEvento(e, false)).join("")}</div>
      </div>`;
    }).join("");
  }

  const lista = filtro === "todos" ? todos : todos.filter(e => e.tipo === filtro);
  let html = "", mesActual = "";
  for (const ev of lista) {
    const mes = aFecha(ev.fecha).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    if (mes !== mesActual) { html += `<div class="mes">${mes}</div>`; mesActual = mes; }
    html += lineaEvento(ev);
  }
  return agregar + selector + `
    ${tipos.length > 1 ? `<div class="filtros" role="group" aria-label="Filtrar">
      <button data-accion="filtro" data-tipo="todos" aria-pressed="${filtro === "todos"}">Todos</button>
      ${tipos.map(t => `<button data-accion="filtro" data-tipo="${t}" aria-pressed="${filtro === t}">${TIPOS_PL[t]}</button>`).join("")}
    </div>` : ""}
    <div class="card">${lista.length ? `<div class="lista">${html}</div>` : `<p class="vacio">No hay registros de este tipo.</p>`}</div>`;
}

function avisos() {
  const pend = pendientes();
  const hechos = vivos("recordatorios").filter(r => r.hecho).sort(porFechaDesc);
  return `
    <button class="btn primario ancho" data-accion="nuevo-aviso">Nuevo aviso</button>
    <div class="card">
      <span class="etiqueta">Pendientes</span>
      ${pend.length ? `<div class="lista">${pend.map(itemAviso).join("")}</div>` : `<p class="vacio">No hay avisos pendientes.</p>`}
      <p class="small muted">«Al calendario» lo agrega a Google Calendar: así el teléfono te avisa aunque la app esté cerrada.</p>
    </div>
    ${hechos.length ? `<details class="card"><summary><span class="etiqueta">Hechos (${hechos.length})</span></summary><div class="lista">${hechos.map(itemAviso).join("")}</div></details>` : ""}`;
}

function ficha() {
  const p = datos.perfil, fid = fotoPerfilId();
  const contactos = vivos("contactos").sort((a, b) => Object.keys(TIPOS_CONTACTO).indexOf(a.tipo) - Object.keys(TIPOS_CONTACTO).indexOf(b.tipo));
  const fila = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "";
  return `
    <div class="card">
      <div class="entre"><span class="etiqueta">Datos</span><button class="editar" data-accion="editar-perfil">Editar</button></div>
      ${fid ? `<div class="foto-perfil foto-marco"><img data-foto="${fid}" alt="Foto de ${esc(p.nombre)}"></div>` : `<button class="btn chico" style="justify-self:start" data-accion="agregar-foto" data-perfil="1">Poner foto de perfil</button>`}
      <dl class="datos">
        ${fila("Nombre", p.nombre)}${fila("Raza", p.raza)}${fila("Sexo", p.sexo)}
        ${fila("Nació", p.nacimiento ? fLarga(p.nacimiento) + " (" + edadTexto(p.nacimiento) + ")" : "")}
        ${fila("Color", p.color)}${fila("Chip", p.chip)}
        ${fila("Alimento", p.alimento ? p.alimento + (p.kcalKg ? " · " + p.kcalKg + " kcal/kg" : "") : "")}
        ${fila("Peso adulto", p.pesoAdulto ? "≈ " + kgTxt(p.pesoAdulto) : "")}
        ${fila("Alergias", p.alergias)}${fila("Notas", p.notas)}
      </dl>
    </div>
    <div class="card">
      <span class="etiqueta">Contactos</span>
      ${contactos.length ? `<div class="lista">${contactos.map(c => `<div class="item">
        <div class="item-cuerpo">
          <span class="item-meta">${TIPOS_CONTACTO[c.tipo] || "Contacto"}</span>
          <span class="item-titulo">${esc(c.nombre)}</span>
          ${c.telefono ? `<span class="num">${esc(c.telefono)}</span>` : ""}
          ${c.direccion ? `<span class="item-detalle">${esc(c.direccion)}</span>` : ""}
          ${c.notas ? `<span class="item-detalle">${esc(c.notas)}</span>` : ""}
          <div class="fila" style="margin-top:6px">
            ${c.telefono ? `<a class="btn chico" href="tel:${esc(c.telefono.replace(/[^\d+]/g, ""))}">Llamar</a>
              <a class="btn chico" href="https://wa.me/${esc(waNumero(c.telefono))}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
            ${c.direccion ? `<a class="btn chico" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.direccion)}" target="_blank" rel="noopener">Cómo llegar</a>` : ""}
          </div>
        </div>
        <button class="editar" data-accion="editar-contacto" data-id="${c.id}">Editar</button></div>`).join("")}</div>`
        : `<p class="vacio">Agregá a su veterinaria y una guardia 24 h para tenerlas a mano.</p>`}
      <button class="btn ancho" data-accion="nuevo-contacto">Agregar contacto</button>
    </div>
    <button class="btn primario ancho" data-accion="ir" data-vista="vet">Resumen para el veterinario</button>
    <div class="card">
      <span class="etiqueta">Sincronización</span>
      <p>${token ? (syncEstado.estado === "ok" ? `Conectada. Última vez: ${new Date(syncEstado.cuando).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}.`
        : syncEstado.estado === "error" ? `Conectada, pero falló: ${esc(syncEstado.mensaje)}` : "Conectada.")
        : "Sin conectar: los datos quedan solo en este teléfono."}</p>
      <form class="campo" data-form="token">
        <label for="tokenIn">Clave de acceso de GitHub</label>
        <input id="tokenIn" name="token" type="password" autocomplete="off" placeholder="github_pat_…" value="${esc(token)}">
        <span class="ayuda">Se guarda solo en este teléfono y solo da acceso a los datos de ${esc(p.nombre || "Kimchi")}.</span>
        <div class="fila" style="margin-top:6px">
          <button class="btn chico primario" type="submit">Guardar y sincronizar</button>
          ${token ? `<button class="btn chico" type="button" data-accion="vincular">Enviar enlace a otro teléfono</button>
            <button class="btn chico peligro" type="button" data-accion="desconectar">Desconectar</button>` : ""}
        </div>
      </form>
    </div>
    <div class="card">
      <span class="etiqueta">Copia de seguridad</span>
      <div class="fila">
        <button class="btn chico" data-accion="exportar">Descargar copia</button>
        <label class="btn chico" for="importar">Restaurar copia</label>
        <input id="importar" type="file" accept="application/json,.json" hidden>
      </div>
      <p class="small muted">La copia lleva los datos; las fotos quedan guardadas en GitHub. Restaurar une la copia con lo que ya hay y no borra nada.</p>
    </div>
    ${instalable && !enApp() ? `<button class="btn ancho" data-accion="instalar">Instalar en la pantalla de inicio</button>` : ""}
    <a class="btn ancho" href="${GUIA}" target="_blank" rel="noopener">Guía de cuidados</a>
    <p class="small muted" style="text-align:center">Libreta de ${esc(p.nombre || "Kimchi")} · versión ${VERSION}</p>`;
}

function waNumero(tel) {
  let n = tel.replace(/\D/g, "");
  if (n.startsWith("0")) n = n.slice(1);
  if (!n.startsWith("54")) n = "549" + n.replace(/^(\d{3,4})15/, "$1"); // celular argentino: 54 9 + área + número, sin el 15
  return n;
}

function vet() {
  const p = datos.perfil, fid = fotoPerfilId();
  const pesos = vivos("pesos").sort(porFechaDesc);
  const ev = vivos("eventos").sort(porFechaDesc);
  const vac = ev.filter(e => e.tipo === "vacuna"), desp = ev.filter(e => e.tipo === "desparasitacion");
  const otros = ev.filter(e => e.tipo !== "vacuna" && e.tipo !== "desparasitacion").slice(0, 20);
  const tablaEv = arr => arr.length ? `<table><thead><tr><th>Fecha</th><th>Detalle</th></tr></thead><tbody>${arr.map(e =>
    `<tr><td class="num">${fNum(e.fecha)}</td><td><b>${esc(e.titulo)}</b>${e.detalle ? "<br>" + esc(e.detalle) : ""}${e.proxima ? `<br><span class="muted">${PROXIMA[e.tipo] || "Próxima"}: ${fNum(e.proxima)}</span>` : ""}</td></tr>`).join("")}</tbody></table>` : `<p class="vacio">Sin registros.</p>`;
  return `<div class="vet" style="display:grid;gap:16px">
    <div class="fila no-print">
      <button class="btn chico" data-accion="ir" data-vista="inicio">← Volver</button>
      <button class="btn chico" data-accion="compartir">Compartir</button>
      <button class="btn chico" data-accion="imprimir">Guardar PDF</button>
    </div>
    <div class="card">
      <div class="fila" style="gap:14px;flex-wrap:nowrap">
        ${fid ? `<div class="foto-mini foto-marco"><img data-foto="${fid}" alt=""></div>` : ""}
        <div><h2>${esc(p.nombre || "Kimchi")} · resumen de salud</h2><p class="small muted">Al ${fLarga(hoyISO())}</p></div>
      </div>
      <dl class="datos">
        <dt>Raza</dt><dd>${esc(p.raza)}</dd><dt>Sexo</dt><dd>${esc(p.sexo)}</dd>
        <dt>Nació</dt><dd>${fLarga(p.nacimiento)} (${edadTexto(p.nacimiento)})</dd>
        ${p.chip ? `<dt>Chip</dt><dd>${esc(p.chip)}</dd>` : ""}
        <dt>Alimento</dt><dd>${esc(p.alimento || "—")}</dd>
        <dt>Alergias</dt><dd>${esc(p.alergias || "Ninguna conocida")}</dd>
        ${p.notas ? `<dt>Notas</dt><dd>${esc(p.notas)}</dd>` : ""}
      </dl>
    </div>
    <div class="card"><h3>Peso</h3>${pesos.length ? `<table><thead><tr><th>Fecha</th><th>Edad</th><th>Peso</th></tr></thead><tbody>${pesos.map(x =>
      `<tr><td class="num">${fNum(x.fecha)}</td><td>${edadTexto(p.nacimiento, x.fecha)}</td><td class="num">${kgTxt(x.kg)}</td></tr>`).join("")}</tbody></table>` : `<p class="vacio">Sin pesos.</p>`}</div>
    <div class="card"><h3>Vacunas</h3>${tablaEv(vac)}</div>
    <div class="card"><h3>Desparasitaciones</h3>${tablaEv(desp)}</div>
    <div class="card"><h3>Consultas, síntomas y tratamientos</h3>${tablaEv(otros)}</div>
  </div>`;
}

function textoVet() {
  const p = datos.perfil, ev = vivos("eventos").sort(porFechaDesc), pesos = vivos("pesos").sort(porFechaDesc);
  const lin = e => `- ${fNum(e.fecha)} ${e.titulo}${e.detalle ? ": " + e.detalle.replace(/\s+/g, " ") : ""}`;
  const secc = (t, arr) => `\n${t}:\n` + (arr.length ? arr.map(lin).join("\n") : "- Sin registros");
  return `${(p.nombre || "Kimchi").toUpperCase()} · resumen de salud (${fNum(hoyISO())})
${p.raza} · ${p.sexo} · nació el ${fNum(p.nacimiento)} (${edadTexto(p.nacimiento)})
Alimento: ${p.alimento || "—"} · Alergias: ${p.alergias || "ninguna conocida"}
Peso: ${pesos.length ? pesos.slice(0, 5).map(x => `${kgTxt(x.kg)} (${fNum(x.fecha)})`).join(", ") : "sin datos"}`
    + secc("Vacunas", ev.filter(e => e.tipo === "vacuna"))
    + secc("Desparasitaciones", ev.filter(e => e.tipo === "desparasitacion"))
    + secc("Últimos registros", ev.filter(e => e.tipo !== "vacuna" && e.tipo !== "desparasitacion").slice(0, 12));
}

// ---------- formularios
function abrirHoja(html) {
  const h = $("#hoja");
  h.innerHTML = html;
  h.showModal();
  history.pushState({ vista, hoja: true }, "");
  const primero = h.querySelector("input:not([type=hidden]):not([type=checkbox]), select, textarea");
  if (primero && !primero.value) primero.focus();
  pintarFotos();
}
function cerrarHoja() { const h = $("#hoja"); if (h.open) { h.close(); if (history.state?.hoja) history.back(); } }
$("#hoja").addEventListener("cancel", e => { e.preventDefault(); cerrarHoja(); });
$("#hoja").addEventListener("click", e => { if (e.target.id === "hoja") cerrarHoja(); });

const campo = (id, label, input, ayuda = "") => `<div class="campo"><label for="${id}">${label}</label>${input}${ayuda ? `<span class="ayuda">${ayuda}</span>` : ""}</div>`;
const inp = (id, v = "", extra = "") => `<input id="${id}" name="${id}" value="${esc(v)}" ${extra}>`;
const area = (id, v = "", extra = "") => `<textarea id="${id}" name="${id}" ${extra}>${esc(v)}</textarea>`;
const casilla = (id, label, marcada) => `<label class="casilla"><input type="checkbox" id="${id}" name="${id}" ${marcada ? "checked" : ""}> ${label}</label>`;
const botones = (borrable) => `<div class="acciones">
  ${borrable ? `<button class="btn peligro" type="button" data-accion="borrar">Borrar</button>` : ""}
  <div class="derecha"><button class="btn" type="button" data-accion="cerrar">Cancelar</button><button class="btn primario" type="submit">Guardar</button></div></div>`;

function hojaEvento(ev) {
  const nuevo = !ev.id;
  const tipoSel = ev.tipo || "nota";
  abrirHoja(`<form class="hoja" data-form="evento" data-id="${ev.id || ""}">
    <h2 id="hojaTitulo">${nuevo ? "Nuevo registro" : "Editar registro"}</h2>
    <div class="dos">
      ${campo("tipo", "Tipo", `<select id="tipo" name="tipo">${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}" ${k === tipoSel ? "selected" : ""}>${v}</option>`).join("")}</select>`)}
      ${campo("fecha", "Fecha", inp("fecha", ev.fecha || hoyISO(), 'type="date" required'))}
    </div>
    ${campo("titulo", "Qué pasó", inp("titulo", ev.titulo, 'required maxlength="120" placeholder="Ej.: Diarrea, vacuna séxtuple, control…"'), "Corto: es lo que se ve en la lista.")}
    ${campo("detalle", "Detalles", area("detalle", ev.detalle, 'placeholder="Qué dijo el vet, dosis, cómo estaba, etc."'))}
    <div id="proxCampo" ${PROXIMA[tipoSel] ? "" : "hidden"}>
      ${campo("proxima", "Próxima fecha (opcional)", inp("proxima", ev.proxima, 'type="date"'), "Crea un aviso automático para ese día.")}
    </div>
    ${botones(!nuevo)}
  </form>`);
  $("#tipo").addEventListener("change", e => { $("#proxCampo").hidden = !PROXIMA[e.target.value]; });
}

function hojaPeso(p) {
  abrirHoja(`<form class="hoja" data-form="peso" data-id="${p.id || ""}">
    <h2 id="hojaTitulo">${p.id ? "Editar peso" : "Anotar peso"}</h2>
    <div class="dos">
      ${campo("kg", "Peso (kg)", inp("kg", p.kg ?? "", 'type="number" inputmode="decimal" step="0.01" min="0.1" max="40" required placeholder="0,9"'))}
      ${campo("fecha", "Fecha", inp("fecha", p.fecha || hoyISO(), 'type="date" required'))}
    </div>
    ${campo("nota", "Nota (opcional)", inp("nota", p.nota, 'maxlength="140" placeholder="Ej.: en la consulta, antes de comer"'))}
    ${botones(!!p.id)}
  </form>`);
}

function hojaAviso(r) {
  abrirHoja(`<form class="hoja" data-form="aviso" data-id="${r.id || ""}">
    <h2 id="hojaTitulo">${r.id ? "Editar aviso" : "Nuevo aviso"}</h2>
    ${campo("titulo", "Qué hay que hacer", inp("titulo", r.titulo, 'required maxlength="120" placeholder="Ej.: Segunda dosis de vacuna"'))}
    ${campo("fecha", "Para cuándo", inp("fecha", r.fecha || sumarDias(hoyISO(), 7), 'type="date" required'))}
    ${campo("detalle", "Detalles (opcional)", area("detalle", r.detalle))}
    ${botones(!!r.id)}
  </form>`);
}

function hojaContacto(c) {
  abrirHoja(`<form class="hoja" data-form="contacto" data-id="${c.id || ""}">
    <h2 id="hojaTitulo">${c.id ? "Editar contacto" : "Nuevo contacto"}</h2>
    <div class="dos">
      ${campo("tipoC", "Tipo", `<select id="tipoC" name="tipoC">${Object.entries(TIPOS_CONTACTO).map(([k, v]) => `<option value="${k}" ${k === (c.tipo || "vet") ? "selected" : ""}>${v}</option>`).join("")}</select>`)}
      ${campo("telefono", "Teléfono", inp("telefono", c.telefono, 'type="tel" inputmode="tel" placeholder="261 555 1234"'))}
    </div>
    ${campo("nombre", "Nombre", inp("nombre", c.nombre, 'required maxlength="80" placeholder="Veterinaria / nombre del vet"'))}
    ${campo("direccion", "Dirección", inp("direccion", c.direccion, 'maxlength="160" placeholder="Calle 123, Ciudad, Mendoza"'))}
    ${campo("notasC", "Notas", area("notasC", c.notas, 'placeholder="Horarios, nombre del vet, etc."'))}
    ${botones(!!c.id)}
  </form>`);
}

function hojaPerfil() {
  const p = datos.perfil;
  abrirHoja(`<form class="hoja" data-form="perfil">
    <h2 id="hojaTitulo">Datos de ${esc(p.nombre || "Kimchi")}</h2>
    <div class="dos">${campo("nombre", "Nombre", inp("nombre", p.nombre, "required"))}${campo("nacimiento", "Nacimiento", inp("nacimiento", p.nacimiento, 'type="date" required'))}</div>
    <div class="dos">${campo("raza", "Raza", inp("raza", p.raza))}${campo("sexo", "Sexo", inp("sexo", p.sexo))}</div>
    <div class="dos">${campo("color", "Color", inp("color", p.color))}${campo("chip", "Chip", inp("chip", p.chip, 'inputmode="numeric"'))}</div>
    ${campo("alimento", "Alimento", inp("alimento", p.alimento, 'placeholder="Marca y línea"'))}
    <div class="dos">${campo("kcalKg", "kcal/kg del alimento", inp("kcalKg", p.kcalKg, 'type="number" inputmode="numeric" min="2500" max="5500"'), "En la bolsa: «energía metabolizable».")}
    ${campo("pesoAdulto", "Peso adulto esperado (kg)", inp("pesoAdulto", p.pesoAdulto, 'type="number" inputmode="decimal" step="0.5" min="1" max="20"'), "Mini: hasta 5 kg.")}</div>
    ${campo("alergias", "Alergias", inp("alergias", p.alergias))}
    ${campo("notas", "Notas", area("notas", p.notas))}
    ${botones(false)}
  </form>`);
}

// Foto nueva: se elige del teléfono (cámara o galería) y se completa fecha y nota.
let archivoFoto = null, fotoParaPerfil = false;
function elegirFoto(paraPerfil) {
  fotoParaPerfil = !!paraPerfil;
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.addEventListener("change", () => { if (input.files[0]) hojaFotoNueva(input.files[0]); });
  input.click();
}
function hojaFotoNueva(file) {
  archivoFoto = file;
  const nac = datos.perfil.nacimiento, f = iso(new Date(file.lastModified || Date.now()));
  const fecha = f >= nac && f <= hoyISO() ? f : hoyISO();
  abrirHoja(`<form class="hoja" data-form="foto-nueva">
    <h2 id="hojaTitulo">Nueva foto</h2>
    <img class="foto-previa" src="${URL.createObjectURL(file)}" alt="">
    <div class="dos">
      ${campo("fecha", "Fecha de la foto", inp("fecha", fecha, 'type="date" required'))}
      ${campo("nota", "Nota (opcional)", inp("nota", "", 'maxlength="140" placeholder="Ej.: primer paseo"'))}
    </div>
    ${casilla("perfil", "Usar como foto de perfil", fotoParaPerfil || !fotoPerfilId())}
    ${botones(false)}
  </form>`);
}
function hojaFoto(f) {
  const nac = datos.perfil.nacimiento;
  abrirHoja(`<form class="hoja" data-form="foto" data-id="${f.id}">
    <div class="foto-grande foto-marco"><img data-foto="${f.id}" alt="Foto del ${fLarga(f.fecha)}"></div>
    <p><b>${edadTexto(nac, f.fecha)}</b> <span class="muted">· ${fLarga(f.fecha)}${f.pendiente ? " · todavía sin subir" : ""}</span></p>
    <div class="dos">
      ${campo("fecha", "Fecha", inp("fecha", f.fecha, 'type="date" required'))}
      ${campo("nota", "Nota", inp("nota", f.nota, 'maxlength="140"'))}
    </div>
    ${casilla("perfil", "Foto de perfil", fotoPerfilId() === f.id)}
    ${botones(true)}
  </form>`);
}

// Guardar formularios
document.addEventListener("submit", async e => {
  const f = e.target, tipo = f.dataset.form;
  if (!tipo) return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f).entries());
  const id = f.dataset.id;
  if (tipo === "token") {
    token = (v.token || "").trim();
    if (token) { guardar(K.token, token); toast("Clave guardada"); sincronizar(); }
    else { borrarLS(K.token); ponerEstado("sin-token"); }
    render();
    return;
  }
  if (tipo === "evento") {
    const ev = { ...(datos.eventos.find(x => x.id === id) || { id: uid() }), tipo: v.tipo, fecha: v.fecha, titulo: v.titulo.trim(), detalle: v.detalle.trim(), proxima: PROXIMA[v.tipo] ? v.proxima : "" };
    cambiar("eventos", ev);
    const rid = "r-" + ev.id, previo = datos.recordatorios.find(x => x.id === rid);
    if (ev.proxima) cambiar("recordatorios", { ...(previo || {}), id: rid, fecha: ev.proxima, titulo: `${PROXIMA[ev.tipo]}: ${ev.titulo}`, detalle: previo?.detalle || "", hecho: previo?.hecho || false, deleted: false });
    else if (previo && !previo.deleted) borrar("recordatorios", rid);
    toast(id ? "Registro actualizado" : "Registro guardado");
  }
  if (tipo === "peso") {
    const kg = parseFloat(String(v.kg).replace(",", "."));
    if (!(kg > 0)) return toast("Revisá el peso");
    cambiar("pesos", { ...(datos.pesos.find(x => x.id === id) || { id: uid() }), kg, fecha: v.fecha, nota: v.nota.trim() });
    toast("Peso guardado");
  }
  if (tipo === "aviso") {
    cambiar("recordatorios", { ...(datos.recordatorios.find(x => x.id === id) || { id: uid(), hecho: false }), fecha: v.fecha, titulo: v.titulo.trim(), detalle: v.detalle.trim() });
    toast("Aviso guardado");
  }
  if (tipo === "contacto") {
    cambiar("contactos", { ...(datos.contactos.find(x => x.id === id) || { id: uid() }), tipo: v.tipoC, nombre: v.nombre.trim(), telefono: v.telefono.trim(), direccion: v.direccion.trim(), notas: v.notasC.trim() });
    toast("Contacto guardado");
  }
  if (tipo === "perfil") {
    datos.perfil = { ...datos.perfil, ...v, kcalKg: Number(v.kcalKg) || 0, pesoAdulto: Number(String(v.pesoAdulto).replace(",", ".")) || 5, updatedAt: ahora() };
    toast("Datos guardados");
  }
  if (tipo === "foto-nueva") {
    if (!archivoFoto) return;
    const btn = f.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Guardando…";
    try {
      const blob = await comprimir(archivoFoto);
      const fid = uid();
      await (await caches.open(FOTOS_CACHE)).put(claveFoto(fid), new Response(blob, { headers: { "Content-Type": "image/jpeg" } }));
      fotosPendientes.push({ id: fid, fecha: v.fecha, nota: (v.nota || "").trim(), perfil: !!v.perfil });
      guardarPendientes();
      archivoFoto = null;
      toast(token ? "Foto guardada; se está subiendo" : "Foto guardada en este teléfono");
    } catch (err) { btn.disabled = false; btn.textContent = "Guardar"; return toast("No se pudo guardar la foto"); }
  }
  if (tipo === "foto") {
    const pend = fotosPendientes.find(x => x.id === id);
    if (pend) { Object.assign(pend, { fecha: v.fecha, nota: (v.nota || "").trim(), perfil: !!v.perfil }); guardarPendientes(); }
    else {
      cambiar("fotos", { ...datos.fotos.find(x => x.id === id), fecha: v.fecha, nota: (v.nota || "").trim() });
      const esPerfil = datos.perfil.fotoId === id;
      if (!!v.perfil !== esPerfil) datos.perfil = { ...datos.perfil, fotoId: v.perfil ? id : "", updatedAt: ahora() };
    }
    toast("Foto actualizada");
  }
  cerrarHoja();
  persistir();
});

// ---------- acciones
let confirmarBorrado = 0;
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-tab], [data-accion]");
  if (!t) return;
  if (t.dataset.tab) return irA(t.dataset.tab);
  const a = t.dataset.accion, id = t.dataset.id;
  switch (a) {
    case "ir": return irA(t.dataset.vista);
    case "sync": return token ? sincronizar() : irA("ficha");
    case "filtro": filtro = t.dataset.tipo; return render();
    case "modo-hist": modoHist = t.dataset.modo; filtro = "todos"; return render();
    case "ver-tipo": modoHist = "todo"; filtro = t.dataset.tipo; render(); return scrollTo(0, 0);
    case "nuevo-evento": return hojaEvento({ tipo: t.dataset.tipo });
    case "editar-evento": return hojaEvento(datos.eventos.find(x => x.id === id));
    case "nuevo-peso": return hojaPeso({});
    case "editar-peso": return hojaPeso(datos.pesos.find(x => x.id === id));
    case "nuevo-aviso": return hojaAviso({});
    case "editar-aviso": return hojaAviso(datos.recordatorios.find(x => x.id === id));
    case "nuevo-contacto": return hojaContacto({});
    case "editar-contacto": return hojaContacto(datos.contactos.find(x => x.id === id));
    case "editar-perfil": return hojaPerfil();
    case "agregar-foto": return elegirFoto(t.dataset.perfil);
    case "ver-foto": return hojaFoto(todasLasFotos().find(x => x.id === id));
    case "cerrar": return cerrarHoja();
    case "hecho": {
      const r = datos.recordatorios.find(x => x.id === id);
      cambiar("recordatorios", { ...r, hecho: !r.hecho });
      return persistir();
    }
    case "borrar": {
      if (Date.now() - confirmarBorrado > 3000) { confirmarBorrado = Date.now(); t.textContent = "¿Seguro? Tocá de nuevo"; return; }
      const f = t.closest("form"), fid = f.dataset.id;
      if (f.dataset.form === "foto") {
        if (fotosPendientes.some(x => x.id === fid)) { fotosPendientes = fotosPendientes.filter(x => x.id !== fid); guardarPendientes(); }
        else {
          borrar("fotos", fid);
          if (datos.perfil.fotoId === fid) datos.perfil = { ...datos.perfil, fotoId: "", updatedAt: ahora() };
          if (token && navigator.onLine) borrarArchivoFoto(fid);
        }
        caches.open(FOTOS_CACHE).then(c => c.delete(claveFoto(fid))).catch(() => {});
      } else {
        const col = { evento: "eventos", peso: "pesos", aviso: "recordatorios", contacto: "contactos" }[f.dataset.form];
        borrar(col, fid);
        if (col === "eventos") { const r = datos.recordatorios.find(x => x.id === "r-" + fid); if (r && !r.deleted) borrar("recordatorios", r.id); }
      }
      cerrarHoja(); toast("Borrado"); return persistir();
    }
    case "compartir": {
      const texto = textoVet();
      try { if (navigator.share) { await navigator.share({ title: "Resumen de salud", text: texto }); return; } } catch (err) { if (err.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(texto); toast("Resumen copiado"); } catch (err) { toast("No se pudo compartir"); }
      return;
    }
    case "imprimir": return print();
    case "vincular": {
      const link = location.origin + location.pathname + "#vincular=" + encodeURIComponent(token);
      const texto = "Abrí este enlace en Chrome para ver la libreta de " + (datos.perfil.nombre || "Kimchi") + " (después borrá este mensaje):";
      try { if (navigator.share) { await navigator.share({ text: texto + "\n" + link }); return; } } catch (err) { if (err.name === "AbortError") return; }
      try { await navigator.clipboard.writeText(link); toast("Enlace copiado"); } catch (err) { toast("No se pudo copiar"); }
      return;
    }
    case "desconectar":
      if (Date.now() - confirmarBorrado > 3000) { confirmarBorrado = Date.now(); t.textContent = "¿Seguro? Tocá de nuevo"; return; }
      token = ""; borrarLS(K.token); ponerEstado("sin-token"); return render();
    case "exportar": {
      const blob = new Blob([JSON.stringify(datos, null, 1)], { type: "application/json" });
      const aEl = document.createElement("a");
      aEl.href = URL.createObjectURL(blob); aEl.download = `kimchi-copia-${hoyISO()}.json`;
      document.body.appendChild(aEl); aEl.click(); aEl.remove();
      return;
    }
    case "instalar":
      if (instalable) { instalable.prompt(); await instalable.userChoice; instalable = null; render(); }
      return;
  }
});

document.addEventListener("change", async e => {
  if (e.target.id !== "importar" || !e.target.files[0]) return;
  try {
    const copia = JSON.parse(await e.target.files[0].text());
    if (!copia.perfil) throw new Error();
    datos = mezclar(datos, copia); persistir(); toast("Copia restaurada");
  } catch (err) { toast("Ese archivo no es una copia de la libreta"); }
});

function linkCalendario(r) {
  const d = r.fecha.replace(/-/g, ""), fin = sumarDias(r.fecha, 1).replace(/-/g, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: `${datos.perfil.nombre || "Kimchi"}: ${r.titulo}`, dates: `${d}/${fin}`, details: r.detalle || "" });
  return "https://calendar.google.com/calendar/render?" + q.toString();
}

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- instalación y arranque
let instalable = null;
const enApp = () => matchMedia("(display-mode: standalone)").matches;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); instalable = e; render(); });
addEventListener("appinstalled", () => { instalable = null; render(); });

if (location.hash.startsWith("#vincular=")) {
  token = decodeURIComponent(location.hash.slice(10));
  guardar(K.token, token);
  history.replaceState(null, "", location.pathname);
  setTimeout(() => toast("Teléfono vinculado"), 300);
}
history.replaceState({ vista }, "");
render();
sincronizar();
addEventListener("online", sincronizar);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sincronizar(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
