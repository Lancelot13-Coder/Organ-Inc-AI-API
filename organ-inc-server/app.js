import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { ROUTE_PATHS, RESPONSE_SCHEMA, buildSystemInstruction } from './knowledge.js';

const MAX_MESSAGES = 12; // cuántos mensajes recientes se envían al modelo
const MAX_CHARS = 800; // largo máximo de cada mensaje del usuario
const MAX_OUTPUT_TOKENS = 700;

const FRIENDLY = {
  badRequest: 'Mensaje inválido.',
  busy: 'El asistente recibió muchas consultas. Inténtalo de nuevo en un minuto.',
  quota: 'El asistente alcanzó su límite de uso por hoy. Vuelve a intentarlo más tarde.',
  upstream: 'El asistente no pudo responder en este momento. Inténtalo de nuevo.',
};

/** Convierte lo que llega del cliente en mensajes limpios, o null si es inválido. */
export function sanitizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const cleaned = [];
  for (const m of raw.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string') return null;
    const text = m.text.trim().slice(0, MAX_CHARS);
    if (text) cleaned.push({ role: m.role, text });
  }

  // El modelo necesita empezar y terminar con un mensaje del usuario.
  while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();
  if (!cleaned.length || cleaned[cleaned.length - 1].role !== 'user') return null;

  // Une mensajes consecutivos del mismo rol (p. ej. si una respuesta falló y el usuario siguió escribiendo).
  const merged = [];
  for (const m of cleaned) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.text = `${last.text}\n${m.text}`.slice(0, MAX_CHARS * 2);
    else merged.push({ ...m });
  }
  return merged;
}

/** Historial -> pasos de la Interactions API (sin guardar nada en Google: store:false). */
export function toSteps(messages) {
  return messages.map((m) => ({
    type: m.role === 'user' ? 'user_input' : 'model_output',
    content: [{ type: 'text', text: m.text }],
  }));
}

/** Valida la respuesta del modelo: aunque el esquema lo fuerza, nunca confiamos a ciegas. */
export function normalizeModelReply(outputText) {
  let data;
  try {
    data = JSON.parse(outputText);
  } catch {
    return null;
  }
  if (!data || typeof data.reply !== 'string' || !data.reply.trim()) return null;

  const seen = new Set();
  const links = (Array.isArray(data.links) ? data.links : [])
    .filter((l) => l && ROUTE_PATHS.includes(l.route) && typeof l.label === 'string' && l.label.trim())
    .filter((l) => !seen.has(l.route) && seen.add(l.route))
    .slice(0, 3)
    .map((l) => ({ route: l.route, label: l.label.trim().slice(0, 40) }));

  const navigate =
    ROUTE_PATHS.includes(data.navigate_route)
      ? { route: data.navigate_route, label: String(data.navigate_label || '').trim().slice(0, 40) || data.navigate_route }
      : null;

  return { reply: data.reply.trim().slice(0, 1500), links, navigate };
}

export function createApp({
  client,
  model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  thinkingLevel = process.env.GEMINI_THINKING_LEVEL ?? 'low',
  corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  perMinute = Number(process.env.RATE_LIMIT_PER_MIN || 15),
  dailyLimit = Number(process.env.DAILY_LIMIT || 400),
  logger = console,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // detrás de Render/Railway/etc. para ver la IP real del usuario

  // Sin lista de orígenes (desarrollo) se permite todo; en producción define CORS_ORIGINS.
  app.use(cors({ origin: corsOrigins.length ? corsOrigins : true }));
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, model }));

  app.use(
    '/api/chat',
    rateLimit({
      windowMs: 60_000,
      limit: perMinute,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: FRIENDLY.busy },
    }),
  );

  // Tope diario global: protege tu cuota gratuita de Gemini (se reinicia cada día).
  let day = new Date().toDateString();
  let used = 0;

  app.post('/api/chat', async (req, res) => {
    const today = new Date().toDateString();
    if (today !== day) {
      day = today;
      used = 0;
    }
    if (used >= dailyLimit) return res.status(429).json({ error: FRIENDLY.quota });

    const messages = sanitizeMessages(req.body?.messages);
    if (!messages) return res.status(400).json({ error: FRIENDLY.badRequest });
    const currentRoute = ROUTE_PATHS.includes(req.body?.currentRoute) ? req.body.currentRoute : undefined;

    used += 1;
    try {
      const request = {
        model,
        system_instruction: buildSystemInstruction(currentRoute),
        input: toSteps(messages),
        store: false,
        response_format: { type: 'text', mime_type: 'application/json', schema: RESPONSE_SCHEMA },
        generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
      };
      if (thinkingLevel) request.generation_config.thinking_level = thinkingLevel;

      const interaction = await client.interactions.create(request);
      const result = normalizeModelReply(interaction.output_text ?? '');
      if (!result) {
        logger.error('Respuesta del modelo inválida:', String(interaction.output_text).slice(0, 300));
        return res.status(502).json({ error: FRIENDLY.upstream });
      }
      return res.json(result);
    } catch (err) {
      used -= 1; // una llamada fallida no debe gastar el cupo diario
      const status = Number(err?.status ?? err?.code);
      logger.error('Error llamando a Gemini:', status || '', err?.message ?? err);
      if (status === 429) return res.status(429).json({ error: FRIENDLY.quota });
      return res.status(502).json({ error: FRIENDLY.upstream });
    }
  });

  // Errores no previstos (JSON malformado, cuerpo demasiado grande...): respuesta limpia, sin trazas.
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: FRIENDLY.badRequest });
    if (err?.status >= 400 && err?.status < 500) return res.status(400).json({ error: FRIENDLY.badRequest });
    logger.error('Error inesperado:', err?.message ?? err);
    return res.status(500).json({ error: FRIENDLY.upstream });
  });

  return app;
}
