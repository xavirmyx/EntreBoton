const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const shortid = require('shortid');

// Configuración de logging
console.log('🚀 Iniciando el bot EntresHijos...');

// Token del bot (sustituye con el tuyo real si es diferente)
const TOKEN = '7624808452:AAHffFqqhaXtun4XthusBfeeeVDcp6Qsrs4';

// Firma y advertencia permanente
const SIGNATURE = '\n\n✨ EntresHijos ✨';
const WARNING_MESSAGE = '\n⚠️ Contenido exclusivo. Prohibido compartir o copiar.';

// Configuración del webhook
const PORT = process.env.PORT || 8443;
const WEBHOOK_URL = 'https://entreboton.onrender.com/webhook';
const REDIRECT_BASE_URL = 'https://entreboton.onrender.com/redirect/';

// Configuración de Supabase
const SUPABASE_URL = 'https://ycvkdxzxrzuwnkybmjwf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljdmtkeHp4cnp1d25reWJtandmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI4Mjg4NzYsImV4cCI6MjA1ODQwNDg3Nn0.1ts8XIpysbMe5heIg3oWLfqKxReusZxemw4lk2WZ4GI';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Mapa para almacenar orígenes de mensajes
const messageOrigins = new Map();

// Crear el bot con webhook
const bot = new TelegramBot(TOKEN, { polling: false });

// Crear el servidor Express
const app = express();
app.use(express.json());

// **Función para inicializar las tablas en Supabase**
async function initializeTables() {
  console.log('🛠️ Verificando y creando tablas en Supabase...');

  // SQL para crear la tabla `interactions`
  const interactionsTableSQL = `
    CREATE TABLE IF NOT EXISTS interactions (
      id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
      type text NOT NULL,
      chat_id text NOT NULL,
      message_id integer NOT NULL,
      user_id text NOT NULL,
      username text,
      timestamp timestamp DEFAULT now() NOT NULL,
      details text
    );
  `;

  // SQL para crear la tabla `short_links`
  const shortLinksTableSQL = `
    CREATE TABLE IF NOT EXISTS short_links (
      id text PRIMARY KEY,
      original_url text NOT NULL,
      message_id integer NOT NULL,
      chat_id text NOT NULL,
      created_at timestamp DEFAULT now()
    );
  `;

  try {
    // Nota: Esto requiere permisos de administrador en Supabase. Si el cliente anónimo no tiene permisos,
    // ejecuta estos comandos manualmente en el panel de SQL de Supabase.
    const { error: interactionsError } = await supabase.rpc('execute_sql', { sql: interactionsTableSQL });
    if (interactionsError) throw new Error(`Error creando tabla interactions: ${interactionsError.message}`);

    const { error: shortLinksError } = await supabase.rpc('execute_sql', { sql: shortLinksTableSQL });
    if (shortLinksError) throw new Error(`Error creando tabla short_links: ${shortLinksError.message}`);

    console.log('✅ Tablas creadas o verificadas exitosamente.');
  } catch (error) {
    console.error(`❌ Error al inicializar tablas: ${error.message}`);
    console.warn('⚠️ Por favor, ejecuta el SQL manualmente en el panel de Supabase con permisos de administrador.');
  }
}

// **Sanitizar texto**
function sanitizeText(text) {
  if (!text) return '';
  return text.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[char] || char)).trim();
}

// **Extraer URLs**
function extractUrls(msg) {
  const text = msg.text || msg.caption || '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let urls = text.match(urlRegex) || [];
  const entities = msg.entities || msg.caption_entities || [];
  const entityUrls = entities.filter(e => e.type === 'url').map(e => text.substr(e.offset, e.length));
  return [...new Set([...urls, ...entityUrls])];
}

// **Acortar URL y almacenar en Supabase**
async function shortenUrl(originalUrl, messageId, chatId) {
  const shortId = shortid.generate();
  const { error } = await supabase.from('short_links').insert([{ id: shortId, original_url: originalUrl, message_id: messageId, chat_id: chatId }]);
  if (error) {
    console.error(`❌ Error al guardar enlace acortado: ${error.message}`);
    return null;
  }
  return `${REDIRECT_BASE_URL}${shortId}`;
}

// **Estructurar mensaje con enlaces acortados**
async function structureMessage(text, urls, messageId, chatId) {
  if (!text) return { formattedText: '', urlPositions: [] };
  let formattedText = text;
  const urlPositions = [];
  for (let i = 0; i < urls.length; i++) {
    const shortUrl = await shortenUrl(urls[i], messageId, chatId);
    if (shortUrl) {
      formattedText = formattedText.replace(urls[i], `<a href="${shortUrl}">🔗 Enlace ${i + 1}</a>`);
      urlPositions.push({ url: urls[i], shortUrl });
    }
  }
  return { formattedText, urlPositions };
}

// **Procesar mensajes**
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = sanitizeText(msg.text || msg.caption);
  const urls = extractUrls(msg);
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  if (msg.text && msg.text.startsWith('/')) return; // Ignorar comandos
  if (!urls.length && !photo && !video && !animation) return;

  const loadingMsg = await bot.sendMessage(chatId, '⏳ Generando publicación...');
  const { formattedText } = await structureMessage(text, urls, loadingMsg.message_id, chatId);
  let caption = formattedText || '📢 Publicación';
  caption += `${SIGNATURE}${WARNING_MESSAGE}`;

  try {
    let sentMessage;
    if (urls.length && !photo && !video && !animation) {
      sentMessage = await bot.editMessageText(caption, { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'HTML', disable_web_page_preview: true, protect_content: true });
    } else if (photo && !urls.length) {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendPhoto(chatId, photo, { caption, parse_mode: 'HTML', protect_content: true });
    } else if (video && !urls.length) {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendVideo(chatId, video, { caption, parse_mode: 'HTML', protect_content: true });
    } else if (animation && !urls.length) {
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendAnimation(chatId, animation, { caption, parse_mode: 'HTML', protect_content: true });
    } else {
      await bot.editMessageText('⚠️ Usa solo un tipo de contenido (enlaces, foto, video o GIF).', { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'HTML' });
      return;
    }
    messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
  } catch (error) {
    console.error(`❌ Error al procesar mensaje: ${error.message}`);
    await bot.editMessageText('⚠️ Error al generar publicación.', { chat_id: chatId, message_id: loadingMsg.message_id, parse_mode: 'HTML' });
  }
});

// **Detectar y manejar reenvíos**
bot.on('message', async (msg) => {
  if (!msg.forward_from && !msg.forward_from_chat && !msg.forward_from_message_id) return;

  const forwardedMessageId = msg.forward_from_message_id;
  const forwardedByUser = msg.from;
  if (!messageOrigins.has(forwardedMessageId)) return;

  const origin = messageOrigins.get(forwardedMessageId);
  const originalChatId = origin.chat_id;
  const userName = forwardedByUser.username ? `@${forwardedByUser.username}` : forwardedByUser.first_name;

  // Advertencia en chat original
  await bot.sendMessage(originalChatId, `🚨 ${userName} reenvió un mensaje exclusivo a ${msg.chat.title || msg.chat.id}!`, { parse_mode: 'HTML' });

  // Intentar eliminar mensaje reenviado
  try {
    await bot.deleteMessage(msg.chat.id, msg.message_id);
    await bot.sendMessage(msg.chat.id, '🚫 Mensaje eliminado por compartir contenido exclusivo.', { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`❌ No se pudo eliminar el mensaje: ${error.message}`);
  }

  // Registrar en Supabase
  const { error } = await supabase.from('interactions').insert([{
    type: 'forward',
    chat_id: originalChatId,
    message_id: forwardedMessageId,
    user_id: forwardedByUser.id,
    username: userName,
    timestamp: new Date().toISOString(),
    details: `Reenviado a: ${msg.chat.id}`
  }]);
  if (error) console.error(`❌ Error al registrar reenvío: ${error.message}`);
});

// **Manejar clics en enlaces**
app.get('/redirect/:shortId', async (req, res) => {
  const { data, error } = await supabase.from('short_links').select('*').eq('id', req.params.shortId).single();
  if (error || !data) return res.status(404).send('Enlace no encontrado');

  const { original_url, message_id, chat_id } = data;
  await supabase.from('interactions').insert([{
    type: 'click',
    chat_id,
    message_id,
    user_id: 'unknown',
    username: 'unknown',
    timestamp: new Date().toISOString(),
    details: `Clic en: ${original_url}`
  }]);
  res.redirect(original_url);
});

// **Comando /visto**
bot.onText(/\/visto/, async (msg) => {
  const chatId = msg.chat.id;
  const { data, error } = await supabase.from('interactions').select('*').eq('chat_id', chatId);
  if (error) return bot.sendMessage(chatId, '⚠️ Error al obtener interacciones.');

  if (!data.length) return bot.sendMessage(chatId, '📊 No hay interacciones registradas.');
  let response = '<b>📊 Interacciones:</b>\n\n';
  data.forEach(r => {
    response += `<b>ID:</b> ${r.message_id}\n<b>Acción:</b> ${r.type}\n<b>Usuario:</b> ${r.username || 'Desconocido'}\n<b>Hora:</b> ${new Date(r.timestamp).toLocaleString('es-ES')}\n<b>Detalles:</b> ${r.details}\n\n`;
  });
  await bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
});

// **Configurar webhook y arrancar**
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  console.log(`✅ Servidor en puerto ${PORT}`);
  await bot.setWebHook(WEBHOOK_URL);
  await initializeTables(); // Inicializar tablas al arrancar
});