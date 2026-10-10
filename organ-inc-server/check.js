// Prueba rápida de tu key y modelo: node check.js
import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { createApp } from './app.js';

if (!process.env.GEMINI_API_KEY) { console.error('❌ Falta GEMINI_API_KEY en .env'); process.exit(1); }

const app = createApp({ client: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) });
const server = app.listen(0, async () => {
  const { port } = server.address();
  try {
    const r = await fetch(`http://localhost:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', text: '¿Qué es la bioimpresión 3D y dónde puedo ver el modelo de la cóclea?' }] }),
    });
    console.log('HTTP', r.status); console.log(JSON.stringify(await r.json(), null, 2));
  } finally { server.close(); }
});
