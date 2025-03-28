const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { nanoid } = require('nanoid');

// Configuración de logging
console.log('🚀 Iniciando el bot EntresHijos...');

// Token del bot
const TOKEN = '7624808452:AAHffFqqhaXtun4XthusBfeeeVDcp6Qsrs4';

// Firma con emojis (permanente en todos los mensajes)
const SIGNATURE = '\n\n✨ EntresHijos ✨';

// Advertencia para no compartir
const WARNING_MESSAGE = '\n⚠️ Este mensaje es exclusivo para este grupo. No lo compartas para proteger el contenido.';

// Lista de frases personalizadas para reemplazar los enlaces
const CUSTOM_PHRASES = [
  'EntresHijos, siempre unidos',
  'EntresHijos siempre contigo',
  'EntresHijos, juntos por siempre',
  'EntresHijos, tu compañero fiel',
  'EntresHijos, conectando pasiones',
  'EntresHijos, siempre a tu lado',
  'EntresHijos, compartiendo momentos',
  'EntresHijos, creando recuerdos',
  'EntresHijos, uniendo corazones',
  'EntresHijos, tu hogar digital',
  'EntresHijos, juntos somos más',
  'EntresHijos, apoyándote siempre',
  'EntresHijos, celebrando la unión',
  'EntresHijos, contigo en cada paso',
  'EntresHijos, donde todo comienza',
  'EntresHijos, un lazo eterno',
  'EntresHijos, siempre en equipo',
  'EntresHijos, vibrando juntos',
  'EntresHijos, tu espacio seguro',
  'EntresHijos, conectando sueños',
  'EntresHijos, siempre presentes',
  'EntresHijos, juntos brillamos',
  'EntresHijos, uniendo generaciones',
  'EntresHijos, contigo al infinito',
  'EntresHijos, somos familia',
];

// Configuración del servidor webhook
const PORT = process.env.PORT || 8443;
const WEBHOOK_URL = 'https://entreboton.onrender.com/webhook';
const REDIRECT_BASE_URL = 'https://entreboton.onrender.com/redirect/';

// Configuración de Supabase (usando variables de entorno)
const SUPABASE_URL = 'https://ycvkdxzxrzuwnkybmjwf.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljdmtkeHp4crp1d25reWJtandmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI4Mjg4NzYsImV4cCI6MjA1ODQwNDg3Nn0.1ts8XIpysbMe5heIg3oWLfqKxReusZxemw4lk2WZ4GI';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Cliente de Supabase con permisos anónimos (para operaciones de lectura)
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Cliente de Supabase con permisos de service_role (para operaciones de escritura)
const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Configuración de grupos y canales específicos
const GRUPOS_PREDEFINIDOS = { '-1002348662107': 'GLOBAL SPORTS STREAM' };
const CANALES_ESPECIFICOS = { '-1002348662107': { chat_id: '-1002348662107', thread_id: '47899' } };

// Mapa para almacenar orígenes de mensajes
const messageOrigins = new Map();

// Lista de usuarios bloqueados (almacenada en memoria, podrías moverla a Supabase para persistencia)
const bannedUsers = new Set();

// Registro de reenvíos por usuario (para bloqueo automático)
const forwardCounts = new Map();

// Estadísticas del bot (almacenadas en memoria, podrías moverlas a Supabase para persistencia)
const stats = {
  messagesProcessed: 0,
  forwardsDetected: 0,
  clicksTracked: 0
};

// Crear el bot con webhook
const bot = new TelegramBot(TOKEN, { polling: false });

// Crear el servidor Express
const app = express();
app.use(express.json());

// **Sanitizar texto**
function sanitizeText(text) {
  if (!text) return '';
  return text.replace(/[<>&'"]/g, char => ({ '<': '<', '>': '>', '&': '&', "'": '\'', '"': '"' }[char] || char)).trim();
}

// **Extraer URLs (preservar todas las ocurrencias, incluso duplicados)**
function extractUrls(msg) {
  const text = msg.text || msg.caption || '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let urls = [];
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    urls.push(match[0]);
  }
  const entities = msg.entities || msg.caption_entities || [];
  const entityUrls = entities.filter(e => e.type === 'url').map(e => text.substr(e.offset, e.length));
  return [...urls, ...entityUrls];
}

// **Generar token para autenticación (truncado a 32 caracteres)**
function generateToken(userId, shortId, ipAddress) {
  const secret = process.env.TOKEN_SECRET || 'tu-clave-secreta-aqui-32-caracteres';
  const fullToken = require('crypto').createHmac('sha256', secret).update(`${userId}-${shortId}-${ipAddress}`).digest('hex');
  return fullToken.substring(0, 32);
}

// **Acortar URL y almacenar en Supabase**
async function shortenUrl(originalUrl, messageId, chatId, userId, username, expiryHours = 24) {
  const shortId = nanoid();
  const token = generateToken(userId, shortId, 'initial');
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

  const dataToInsert = {
    id: shortId,
    original_url: originalUrl,
    message_id: messageId,
    chat_id: chatId,
    user_id: userId,
    token,
    expires_at: expiresAt,
    ip_address: null
  };

  if (username) {
    dataToInsert.username = username;
  }

  const { error } = await supabaseService.from('short_links').insert([dataToInsert]);
  if (error) {
    console.error(`❌ Error al guardar enlace acortado: ${error.message}`);
    return null;
  }
  console.log(`✅ Enlace acortado guardado en Supabase: ${shortId}`);
  stats.clicksTracked++;
  return { shortId, token };
}

// **Dividir mensaje en partes si excede el límite de Telegram (4096 caracteres)**
function splitMessage(text, maxLength = 4096) {
  const parts = [];
  let currentPart = '';

  const lines = text.split('\n');
  for (const line of lines) {
    if (currentPart.length + line.length + 1 > maxLength) {
      parts.push(currentPart.trim());
      currentPart = '';
    }
    currentPart += line + '\n';
  }

  if (currentPart.trim()) {
    parts.push(currentPart.trim());
  }

  return parts;
}

// **Estructurar mensaje con enlaces acortados (por evento)**
async function structureMessage(text, urls, messageId, chatId, userId, username) {
  if (!text && !urls.length) return { formattedText: '', shortLinks: [] };

  let formattedText = text || '📢 Publicación';
  const shortLinks = [];
  const lines = formattedText.split('\n');
  const events = [];
  let currentEvent = { text: '', urls: [] };

  // Separar el texto en eventos basados en líneas con horas
  const timeRegex = /^\d{2}:\d{2}/;
  for (const line of lines) {
    if (timeRegex.test(line.trim())) {
      if (currentEvent.text) {
        events.push(currentEvent);
      }
      currentEvent = { text: line, urls: [] };
    } else if (line) {
      currentEvent.text += '\n' + line;
    }
  }
  if (currentEvent.text) {
    events.push(currentEvent);
  }

  // Asignar URLs a cada evento
  let urlIndex = 0;
  for (let i = 0; i < events.length && urlIndex < urls.length; i++) {
    const eventText = events[i].text;
    let nextEventIndex = i + 1;
    let nextEventStart = nextEventIndex < events.length ? text.indexOf(events[nextEventIndex].text) : text.length;

    while (urlIndex < urls.length && text.indexOf(urls[urlIndex]) < nextEventStart && text.indexOf(urls[urlIndex]) >= text.indexOf(eventText)) {
      events[i].urls.push(urls[urlIndex]);
      urlIndex++;
    }
  }

  // Procesar URLs por evento
  for (const event of events) {
    const eventUrls = event.urls;
    if (eventUrls.length > 0) {
      const shortLinksPromises = eventUrls.map(async (url, idx) => {
        const shortLink = await shortenUrl(url, messageId, chatId, userId, username);
        if (shortLink) {
          const { shortId, token } = shortLink;
          const callbackData = `click:${shortId}:${token}`;
          return { url, shortId, token, callbackData };
        }
        console.warn(`⚠️ No se pudo acortar el enlace: ${url}`);
        return null;
      });

      const results = (await Promise.all(shortLinksPromises)).filter(link => link !== null);
      shortLinks.push(...results);

      // Reemplazar URLs en el texto del evento con frases personalizadas
      let eventTextModified = event.text;
      results.forEach((link, idx) => {
        const phraseIndex = idx % CUSTOM_PHRASES.length;
        const replacementPhrase = CUSTOM_PHRASES[phraseIndex];
        eventTextModified = eventTextModified.replace(link.url, replacementPhrase);
      });
      event.text = eventTextModified;
    }
  }

  // Reconstruir el texto formateado
  formattedText = events.map(event => event.text.trim()).join('\n\n');
  console.log(`✅ ${shortLinks.length} enlaces acortados.`);
  console.log(`📝 Texto formateado: ${formattedText}`);
  return { formattedText, shortLinks, events };
}

// **Verificar si el usuario es administrador**
async function isAdmin(chatId, userId) {
  try {
    const { members } = await bot.getChatAdministrators(chatId);
    return members.some(member => member.user.id === userId);
  } catch (error) {
    console.error(`❌ Error al verificar administrador: ${error.message}`);
    return false;
  }
}

// **Comando /start**
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return;
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const channel = CANALES_ESPECIFICOS[chatId];
  const welcomeMessage = `
<b>¡Bienvenido a EntresHijos! ✨</b>

Soy un bot diseñado para proteger el contenido exclusivo de este grupo. Aquí tienes algunas cosas que puedo hacer:

📌 <b>Proteger enlaces:</b> Convierto los enlaces en enlaces acortados y protegidos que expiran después de 24 horas.
📸 <b>Proteger multimedia:</b> Evito que las fotos, videos y GIFs sean reenviados.
🚨 <b>Detectar reenvíos:</b> Si alguien reenvía un mensaje exclusivo, lo detectaré y notificaré al grupo.
📊 <b>Ver interacciones:</b> Usa /visto para ver quién ha interactuado con los mensajes.
📊 <b>Ver clics:</b> Usa /clics para ver quién ha hecho clic en los enlaces.

<b>Comandos útiles:</b>
/visto - Ver interacciones (reenvíos).
/clics - Ver clics en enlaces.
/stats - Ver estadísticas del bot.
/banuser <user_id> - (Admins) Bloquear a un usuario para que no pueda reenviar mensajes.

¡Envía un enlace, foto, video o GIF para empezar! 🚀
  `;
  await bot.sendMessage(channel.chat_id, welcomeMessage, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Procesar mensajes**
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return;
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const userId = msg.from.id.toString();
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

  if (bannedUsers.has(userId)) {
    const channel = CANALES_ESPECIFICOS[chatId];
    await bot.sendMessage(channel.chat_id, `🚫 Lo siento, ${username}, has sido bloqueado por compartir contenido exclusivo. Contacta a un administrador para resolver esto.`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
    return;
  }

  const text = sanitizeText(msg.text || msg.caption);
  const urls = extractUrls(msg);
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  if (msg.text && msg.text.startsWith('/')) return;
  if (!urls.length && !photo && !video && !animation) return;

  const channel = CANALES_ESPECIFICOS[chatId];
  const loadingMsg = await bot.sendMessage(channel.chat_id, '⏳ Generando publicación...', { message_thread_id: channel.thread_id });

  let caption = text || '📢 Publicación';
  let shortLinks = [];
  let events = [];
  if (urls.length) {
    const { formattedText, shortLinks: links, events: eventData } = await structureMessage(text, urls, loadingMsg.message_id, chatId, userId, username);
    caption = formattedText || '📢 Publicación';
    shortLinks = links;
    events = eventData;
  }
  caption += `${SIGNATURE}${WARNING_MESSAGE}`;

  try {
    const messageParts = splitMessage(caption);
    let sentMessage;

    // Crear botones inline por evento
    const inlineKeyboards = events.map(event => {
      const eventLinks = shortLinks.filter(link => event.urls.includes(link.url));
      return eventLinks.map(link => [{ text: '🔗 Abrir enlace', callback_data: link.callbackData }]);
    });

    await bot.deleteMessage(channel.chat_id, loadingMsg.message_id, { message_thread_id: channel.thread_id });

    if (photo) {
      sentMessage = await bot.sendPhoto(channel.chat_id, photo, {
        caption: messageParts[0],
        message_thread_id: channel.thread_id,
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: inlineKeyboards.length ? { inline_keyboard: inlineKeyboards.flat() } : undefined
      });
      for (let i = 1; i < messageParts.length; i++) {
        await bot.sendMessage(channel.chat_id, messageParts[i], { message_thread_id: channel.thread_id, parse_mode: 'HTML', protect_content: true });
      }
    } else if (video) {
      sentMessage = await bot.sendVideo(channel.chat_id, video, {
        caption: messageParts[0],
        message_thread_id: channel.thread_id,
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: inlineKeyboards.length ? { inline_keyboard: inlineKeyboards.flat() } : undefined
      });
      for (let i = 1; i < messageParts.length; i++) {
        await bot.sendMessage(channel.chat_id, messageParts[i], { message_thread_id: channel.thread_id, parse_mode: 'HTML', protect_content: true });
      }
    } else if (animation) {
      sentMessage = await bot.sendAnimation(channel.chat_id, animation, {
        caption: messageParts[0],
        message_thread_id: channel.thread_id,
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: inlineKeyboards.length ? { inline_keyboard: inlineKeyboards.flat() } : undefined
      });
      for (let i = 1; i < messageParts.length; i++) {
        await bot.sendMessage(channel.chat_id, messageParts[i], { message_thread_id: channel.thread_id, parse_mode: 'HTML', protect_content: true });
      }
    } else {
      sentMessage = await bot.sendMessage(channel.chat_id, messageParts[0], {
        message_thread_id: channel.thread_id,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
        reply_markup: inlineKeyboards.length ? { inline_keyboard: inlineKeyboards.flat() } : undefined
      });
      for (let i = 1; i < messageParts.length; i++) {
        await bot.sendMessage(channel.chat_id, messageParts[i], { message_thread_id: channel.thread_id, parse_mode: 'HTML', disable_web_page_preview: true, protect_content: true });
      }
    }
    messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
    stats.messagesProcessed++;
  } catch (error) {
    console.error(`❌ Error al procesar mensaje: ${error.message}`);
    await bot.sendMessage(channel.chat_id, '⚠️ Error al generar publicación.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }
});

// **Manejar clics en botones inline**
bot.on('callback_query', async (query) => {
  const callbackQueryId = query.id;
  const callbackData = query.data;
  const username = query.from.username ? `@${query.from.username}` : query.from.first_name;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  try {
    const dataParts = callbackData.split(':');
    if (dataParts.length !== 3 || dataParts[0] !== 'click') {
      console.error(`❌ Formato de callbackData inválido: ${callbackData}`);
      return bot.answerCallbackQuery(callbackQueryId, { text: 'Error: Formato de enlace inválido.' });
    }

    const shortId = dataParts[1];
    const token = dataParts[2];

    const { data: linkData, error } = await supabaseAnon
      .from('short_links')
      .select('original_url')
      .eq('id', shortId)
      .single();

    if (error || !linkData) {
      console.error('Error al obtener el enlace desde Supabase:', error);
      return bot.answerCallbackQuery(callbackQueryId, { text: 'Error al procesar el enlace.' });
    }

    const originalUrl = linkData.original_url;

    const { error: clickError } = await supabaseService.from('clicks').insert({
      short_code: shortId,
      username: username,
      clicked_at: new Date().toISOString(),
    });

    if (clickError) {
      console.error('Error al registrar el clic en Supabase:', clickError);
    } else {
      console.log('✅ Clic registrado correctamente en Supabase');
    }

    const redirectToken = require('crypto').randomBytes(16).toString('hex');
    const redirectUrl = `${REDIRECT_BASE_URL}${shortId}?token=${redirectToken}`;

    await bot.answerCallbackQuery(callbackQueryId, {
      text: 'Enlace procesado. Haz clic en el botón para continuar.',
      show_alert: true,
    });

    const redirectMessage = await bot.sendMessage(chatId, `${username}, haz clic para ver el contenido:`, {
      reply_to_message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Abrir enlace', url: redirectUrl }]]
      },
    });

    setTimeout(async () => {
      try {
        await bot.deleteMessage(chatId, redirectMessage.message_id);
        console.log(`✅ Mensaje "Haz clic para ver el contenido" eliminado después de 30 segundos.`);
      } catch (error) {
        console.error(`❌ Error al eliminar el mensaje de redirección: ${error.message}`);
      }
    }, 30 * 1000);
  } catch (error) {
    console.error('Error al procesar el callback:', error);
    if (error.code === 'ETELEGRAM' && error.response?.body?.description?.includes('query is too old')) {
      await bot.sendMessage(chatId, 'Lo siento, el enlace ha expirado. Por favor, intenta de nuevo.');
    } else {
      await bot.sendMessage(chatId, 'Ocurrió un error al procesar el enlace. Por favor, intenta de nuevo.');
    }
  }
});

// **Detectar y manejar reenvíos**
bot.on('message', async (msg) => {
  if (!msg.forward_from && !msg.forward_from_chat && !msg.forward_from_message_id) return;

  const chatId = msg.chat.id.toString();
  if (!GRUPOS_PREDEFINIDOS[chatId]) return;

  const forwardedMessageId = msg.forward_from_message_id;
  const forwardedByUser = msg.from;
  const userId = forwardedByUser.id.toString();
  const username = forwardedByUser.username ? `@${forwardedByUser.username}` : forwardedByUser.first_name;

  const forwardedFrom = msg.forward_from || msg.forward_from_chat;
  const isBotMessage = forwardedFrom && forwardedFrom.id === bot.id;

  if (!messageOrigins.has(forwardedMessageId) && !isBotMessage) return;

  const origin = messageOrigins.get(forwardedMessageId) || { chat_id: chatId };
  const originalChatId = origin.chat_id;
  const channel = CANALES_ESPECIFICOS[originalChatId];

  const currentCount = (forwardCounts.get(userId) || 0) + 1;
  forwardCounts.set(userId, currentCount);

  if (currentCount > 3) {
    bannedUsers.add(userId);
    await bot.sendMessage(channel.chat_id, `🚫 ${username} ha sido bloqueado automáticamente por reenviar mensajes exclusivos repetidamente.`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }

  await bot.sendMessage(channel.chat_id, `🚨 ${username} reenvió un mensaje exclusivo a ${msg.chat.title || msg.chat.id}!`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });

  try {
    await bot.deleteMessage(msg.chat.id, msg.message_id);
    await bot.sendMessage(msg.chat.id, `🚫 Mensaje eliminado por compartir contenido exclusivo, ${username}.`, { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`❌ No se pudo eliminar el mensaje: ${error.message}`);
  }

  const { error } = await supabaseService.from('interactions').insert([{
    type: 'forward',
    chat_id: originalChatId,
    message_id: forwardedMessageId,
    user_id: userId,
    username,
    timestamp: new Date().toISOString(),
    details: `Reenviado a: ${msg.chat.id}`
  }]);
  if (error) {
    console.error(`❌ Error al registrar reenvío: ${error.message}`);
  } else {
    console.log(`✅ Reenvío registrado en Supabase: ${username} reenvió mensaje ${forwardedMessageId}`);
  }
  stats.forwardsDetected++;
});

// **Comando /visto**
bot.onText(/\/visto/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return;
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const channel = CANALES_ESPECIFICOS[chatId];
  const { data, error } = await supabaseAnon
    .from('interactions')
    .select(`
      *,
      timestamp (timestamp AT TIME ZONE 'Europe/Madrid' AS timestamp_local)
    `)
    .eq('chat_id', chatId);
  if (error) {
    console.error(`❌ Error al obtener interacciones: ${error.message}`);
    return bot.sendMessage(channel.chat_id, '⚠️ Error al obtener interacciones.', { message_thread_id: channel.thread_id });
  }

  if (!data.length) return bot.sendMessage(channel.chat_id, '📊 No hay interacciones registradas.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  let response = '<b>📊 Interacciones:</b>\n\n';
  data.forEach(r => {
    response += `<b>ID:</b> ${r.message_id}\n<b>Acción:</b> ${r.type}\n<b>Usuario:</b> ${r.username || 'Desconocido'}\n<b>Hora:</b> ${new Date(r.timestamp_local).toLocaleString('es-ES')}\n<b>Detalles:</b> ${r.details}\n\n`;
  });
  await bot.sendMessage(channel.chat_id, response, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Comando /clics**
bot.onText(/\/clics/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return;
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const channel = CANALES_ESPECIFICOS[chatId];
  const { data, error } = await supabaseAnon
    .from('clicks')
    .select(`
      *,
      clicked_at (clicked_at AT TIME ZONE 'Europe/Madrid' AS clicked_at_local),
      created_at (created_at AT TIME ZONE 'Europe/Madrid' AS created_at_local)
    `);
  if (error) {
    console.error(`❌ Error al obtener clics: ${error.message}`);
    return bot.sendMessage(channel.chat_id, '⚠️ Error al obtener clics.', { message_thread_id: channel.thread_id });
  }

  if (!data.length) return bot.sendMessage(channel.chat_id, '📊 No hay clics registrados.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  let response = '<b>📊 Clics:</b>\n\n';
  data.forEach(r => {
    response += `<b>ID:</b> ${r.id}\n<b>Short Code:</b> ${r.short_code}\n<b>Usuario:</b> ${r.username || 'Desconocido'}\n<b>Hora de Clic:</b> ${new Date(r.clicked_at_local).toLocaleString('es-ES')}\n<b>Creado:</b> ${new Date(r.created_at_local).toLocaleString('es-ES')}\n\n`;
  });
  await bot.sendMessage(channel.chat_id, response, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Comando /stats**
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return;
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const channel = CANALES_ESPECIFICOS[chatId];
  const statsMessage = `
<b>📈 Estadísticas de EntresHijos:</b>

📩 <b>Mensajes procesados:</b> ${stats.messagesProcessed}
🚨 <b>Reenvíos detectados:</b> ${stats.forwardsDetected}
🔗 <b>Clics rastreados:</b> ${stats.clicksTracked}
🚫 <b>Usuarios bloqueados:</b> ${bannedUsers.size}

¡Gracias por usar EntresHijos! ✨
  `;
  await bot.sendMessage(channel.chat_id, statsMessage, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Comando /banuser (solo para administradores)**
bot.onText(/\/banuser (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return;
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const userId = msg.from.id;
  const targetUserId = match[1];
  const channel = CANALES_ESPECIFICOS[chatId];

  const isUserAdmin = await isAdmin(chatId, userId);
  if (!isUserAdmin) {
    await bot.sendMessage(channel.chat_id, '🚫 Solo los administradores pueden usar este comando.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
    return;
  }

  bannedUsers.add(targetUserId);
  await bot.sendMessage(channel.chat_id, `🚫 El usuario con ID ${targetUserId} ha sido bloqueado y no podrá reenviar mensajes.`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Ruta para manejar el webhook de Telegram**
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// **Ruta para manejar la redirección de enlaces acortados**
app.get('/redirect/:shortId', async (req, res) => {
  const { shortId } = req.params;
  const { token } = req.query;

  try {
    const { data: linkData, error } = await supabaseAnon
      .from('short_links')
      .select('original_url, expires_at')
      .eq('id', shortId)
      .single();

    if (error || !linkData) {
      console.error(`❌ Error al obtener el enlace desde Supabase: ${error?.message || 'Enlace no encontrado'}`);
      return res.status(404).send('Enlace no encontrado o expirado.');
    }

    const expiresAt = new Date(linkData.expires_at);
    const now = new Date();
    if (now > expiresAt) {
      console.warn(`⚠️ Enlace expirado: ${shortId}`);
      return res.status(410).send('El enlace ha expirado.');
    }

    console.log(`✅ Redirigiendo a: ${linkData.original_url}`);
    res.redirect(linkData.original_url);
  } catch (error) {
    console.error(`❌ Error al procesar la redirección: ${error.message}`);
    res.status(500).send('Error interno del servidor.');
  }
});

// **Configurar webhook y arrancar**
app.listen(PORT, async () => {
  console.log(`✅ Servidor en puerto ${PORT}`);
  await bot.setWebHook(WEBHOOK_URL);
});