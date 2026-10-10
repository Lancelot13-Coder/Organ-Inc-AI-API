import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import { createApp } from './app.js';

if (!process.env.GEMINI_API_KEY) {
  console.error('\n❌ Falta GEMINI_API_KEY. Copia .env.example a .env y pega tu key de https://aistudio.google.com/apikey\n');
  process.exit(1);
}

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const app = createApp({ client });
const port = Number(process.env.PORT || 3001);

app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Asistente listo en http://localhost:${port}  (modelo: ${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'})`);
});
