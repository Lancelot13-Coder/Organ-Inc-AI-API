# Servidor del Asistente 3D Organ Inc

Mini backend en Node.js que guarda tu API key de Gemini y es el único que habla con Google.
La app (web y móvil) solo habla con este servidor, así la key nunca queda dentro del código descargable.

## Puesta en marcha (5 pasos)

1. **Ubicación:** deja esta carpeta FUERA de tu proyecto Expo, al lado (ej. `Alpha/organ-inc-server` junto a `Alpha/OrganInc`).
   Si la metes dentro, Metro intentará indexar su `node_modules` y se vuelve lento.
2. **API key gratuita:** https://aistudio.google.com/apikey → "Create API key".
3. En esta carpeta: copia `.env.example` a `.env` y pega tu key en `GEMINI_API_KEY=`.
4. `npm install`
5. `npm run check` (prueba tu key y el modelo con una pregunta real) y luego `npm start`.

Debe decir: `✅ Asistente listo en http://localhost:3001`.

## Probar con la app
- **Web:** `npx expo start` → `w`. Funciona sin configurar nada.
- **Celular (Expo Go):** el celular y el PC en la MISMA red Wi-Fi. La app toma la IP de tu PC automáticamente.
  En Windows, la primera vez que corra el servidor acepta el aviso del Firewall (redes privadas),
  o el celular no podrá conectarse al puerto 3001.

## Comandos
| Comando | Qué hace |
|---|---|
| `npm start` | Inicia el servidor |
| `npm run dev` | Inicia y reinicia al guardar cambios |
| `npm run check` | Verifica key + modelo con una pregunta real |
| `npm test` | 19 pruebas automáticas (no gastan cuota ni necesitan key) |

## Mantenimiento
- **El asistente solo sabe lo que está en `knowledge.js`.** Si cambias textos de la web o creas una página nueva,
  actualiza ese archivo (la tabla `ROUTES` y el texto de `KNOWLEDGE`). Las rutas que no estén en `ROUTES`
  nunca se le mostrarán al usuario.
- Modelo por defecto: `gemini-3.5-flash-lite` (cambia con `GEMINI_MODEL` en `.env`). Los modelos Gemini 2.5
  se apagan el 16 de octubre de 2026: no los uses.
- Protecciones incluidas: límite por minuto por IP (15), tope diario global (400, protege tu cuota gratuita),
  tamaño máximo de mensaje, y solo se aceptan rutas reales de la app.

## Producción (cuando publiques)
1. Despliega esta carpeta en un servicio Node (Render, Railway, Fly.io…) y define allí `GEMINI_API_KEY` y
   `CORS_ORIGINS=https://tu-dominio.com`.
2. En la app, crea un `.env` con `EXPO_PUBLIC_ASSISTANT_URL=https://tu-servidor.com` (debe ser https).

## Privacidad
En el plan gratuito de Gemini, Google puede usar lo que se envía para mejorar sus productos. Por eso el chat avisa
"No compartas datos personales". Si más adelante quieres evitarlo, activa facturación en tu proyecto de Google AI
(el plan de pago no usa los datos para mejorar sus productos) y considera reflejarlo en tu página de privacidad.
