import assert from 'node:assert/strict';
import http from 'node:http';
import { GoogleGenAI } from '@google/genai';
import { createApp, sanitizeMessages, normalizeModelReply } from './app.js';
import { ROUTES } from './knowledge.js';

let passed = 0;
const ok = (name) => { passed++; console.log('  ✔', name); };
const silent = { error() {}, log() {} };

// ---- 1) funciones puras
assert.equal(sanitizeMessages([]), null); ok('rechaza historial vacío');
assert.equal(sanitizeMessages([{ role: 'system', text: 'x' }]), null); ok('rechaza roles inválidos');
assert.equal(sanitizeMessages([{ role: 'assistant', text: 'hola' }]), null); ok('rechaza si no termina en usuario');
assert.deepEqual(sanitizeMessages([{ role: 'assistant', text: 'hola' }, { role: 'user', text: ' ¿qué es? ' }]), [{ role: 'user', text: '¿qué es?' }]); ok('recorta y descarta mensajes iniciales del asistente');
assert.deepEqual(sanitizeMessages([{ role: 'user', text: 'uno' }, { role: 'user', text: 'dos' }]), [{ role: 'user', text: 'uno\ndos' }]); ok('une mensajes consecutivos del mismo rol');
assert.equal(sanitizeMessages([{ role: 'user', text: 'a'.repeat(5000) }])[0].text.length, 800); ok('limita 800 caracteres por mensaje');
assert.equal(sanitizeMessages(Array.from({ length: 41 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'm' + i }))).length <= 12, true); ok('limita el historial a 12 mensajes');
const n = normalizeModelReply(JSON.stringify({ reply: 'Hola', links: [{ route: '/oido', label: 'Oído' }, { route: '/oido', label: 'dup' }, { route: '/hackeado', label: 'x' }, { route: '/contactus', label: 'c' }], navigate_route: '/inventada', navigate_label: 'z' }));
assert.deepEqual(n.links, [{ route: '/oido', label: 'Oído' }]); assert.equal(n.navigate, null); ok('descarta rutas inventadas, duplicados y /contactus (no existe)');
assert.equal(normalizeModelReply('no es json'), null); assert.equal(normalizeModelReply('{"reply":""}'), null); ok('rechaza respuestas del modelo mal formadas');

// ---- 2) servidor Gemini FALSO + SDK REAL
const captured = [];
let nextBody = null; // qué debe devolver el "modelo"
let nextStatus = 200;
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => {
    captured.push({ method: req.method, url: req.url, key: req.headers['x-goog-api-key'], body: b ? JSON.parse(b) : null });
    res.writeHead(nextStatus, { 'Content-Type': 'application/json' });
    if (nextStatus !== 200) return res.end(JSON.stringify({ error: { code: nextStatus, message: 'forced error', status: 'RESOURCE_EXHAUSTED' } }));
    res.end(JSON.stringify({ id: 'int_1', status: 'completed', model: 'gemini-3.5-flash-lite', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(nextBody) }] }] }));
  });
});
await new Promise((r) => fake.listen(0, r));
const client = new GoogleGenAI({ apiKey: 'FAKE_SERVER_KEY', httpOptions: { baseUrl: `http://localhost:${fake.address().port}` } });

const start = (opts) => new Promise((r) => { const s = createApp({ client, logger: silent, ...opts }).listen(0, () => r(s)); });
const post = (s, body) => fetch(`http://localhost:${s.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let s = await start({ perMinute: 100 });
nextBody = { reply: 'La cóclea convierte vibraciones en señales nerviosas.', links: [{ route: '/modelo-3d-coclea', label: 'Ver modelo de la cóclea' }, { route: '/ruta-falsa', label: 'x' }], navigate_route: '/modelo-3d-coclea', navigate_label: 'Cóclea' };
let r = await post(s, { currentRoute: '/oido', messages: [{ role: 'user', text: 'hola' }, { role: 'assistant', text: 'Hola, ¿en qué te ayudo?' }, { role: 'user', text: 'llévame a la cóclea' }] });
let j = await r.json();
assert.equal(r.status, 200); assert.equal(j.reply.startsWith('La cóclea'), true);
assert.deepEqual(j.links, [{ route: '/modelo-3d-coclea', label: 'Ver modelo de la cóclea' }]);
assert.deepEqual(j.navigate, { route: '/modelo-3d-coclea', label: 'Cóclea' }); ok('respuesta completa: texto + botón + navegación (ruta falsa filtrada)');

const w = captured.at(-1);
console.log('\n  --- petición REAL que genera el SDK hacia Gemini ---');
console.log('  ', w.method, w.url);
console.log('   x-goog-api-key presente:', w.key === 'FAKE_SERVER_KEY');
console.log('   model:', w.body.model, '| store:', w.body.store, '| generation_config:', JSON.stringify(w.body.generation_config));
console.log('   response_format:', w.body.response_format.type, w.body.response_format.mime_type, '| schema props:', Object.keys(w.body.response_format.schema.properties).join(','));
console.log('   input:', JSON.stringify(w.body.input.map((x) => x.type)));
console.log('   system_instruction incluye contexto de página:', w.body.system_instruction.includes('Oído 3D'), '| largo:', w.body.system_instruction.length, 'chars\n');
assert.match(w.url, /\/v1beta\/interactions/); assert.equal(w.key, 'FAKE_SERVER_KEY'); assert.equal(w.body.store, false);
assert.deepEqual(w.body.input.map((x) => x.type), ['user_input', 'model_output', 'user_input']); ok('historial viaja como user_input/model_output y store:false');
assert.deepEqual(w.body.response_format.schema.properties.navigate_route.enum.includes('none'), true);
assert.equal(w.body.response_format.schema.properties.links.items.properties.route.enum.length, ROUTES.length); ok('el esquema restringe las rutas a las ' + ROUTES.length + ' páginas reales');

r = await post(s, { messages: [] }); assert.equal(r.status, 400); ok('400 con historial vacío');
r = await post(s, { messages: [{ role: 'assistant', text: 'x' }] }); assert.equal(r.status, 400); ok('400 si el último mensaje no es del usuario');
r = await fetch(`http://localhost:${s.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{malformado' }); assert.equal(r.status >= 400 && r.status < 500, true); ok('JSON malformado no tumba el servidor');

nextBody = { reply: '' }; r = await post(s, { messages: [{ role: 'user', text: 'hola' }] }); assert.equal(r.status, 502); ok('502 amable si el modelo devuelve algo inválido');
nextStatus = 429; r = await post(s, { messages: [{ role: 'user', text: 'hola' }] }); j = await r.json();
assert.equal(r.status, 429); assert.equal(JSON.stringify(j).includes('FAKE_SERVER_KEY'), false); ok('429 de Google se traduce a mensaje amigable y sin filtrar la key');
nextStatus = 200;
s.close();

s = await start({ perMinute: 2 });
nextBody = { reply: 'ok', links: [], navigate_route: 'none', navigate_label: '' };
const codes = []; for (let i = 0; i < 4; i++) codes.push((await post(s, { messages: [{ role: 'user', text: 'hola' }] })).status);
assert.deepEqual(codes, [200, 200, 429, 429]); ok('límite por minuto por IP (200,200,429,429)');
s.close();

s = await start({ perMinute: 100, dailyLimit: 2 });
const d = []; for (let i = 0; i < 3; i++) d.push((await post(s, { messages: [{ role: 'user', text: 'hola' }] })).status);
assert.deepEqual(d, [200, 200, 429]); ok('tope diario protege tu cuota gratuita (200,200,429)');
s.close(); fake.close();

console.log(`\n${passed} pruebas OK`);
