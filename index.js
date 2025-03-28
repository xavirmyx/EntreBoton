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
const WARNING_MESSAGE = '\n**⚠️ Este contenido es exclusivo. No lo compartas ni tomes capturas de pantalla para protegerlo.**';

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

// Configuración de Supabase
const SUPABASE_URL = 'https://ycvkdxzxrzuwnkybmjwf.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljdmtkeHp4crp1d25reWJtandmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI4Mjg4NzYsImV4cCI6MjA1ODQwNDg3Nn0.1ts8XIpysbMe5heIg3oWLfqKxReusZxemw4lk2WZ4GI';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Cliente de Supabase
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Configuración de grupos y canales
const GRUPOS_PREDEFINIDOS = { '-1002348662107': 'GLOBAL SPORTS STREAM' };
const CANALES_ESPECIFICOS = { '-1002348662107': { chat_id: '-1002348662107', thread_id: '47899' } };

// Almacenamiento en memoria
const messageOrigins = new Map();
const bannedUsers = new Set();
const forwardCounts = new Map();
const stats = { messagesProcessed: 0, forwardsDetected: 0, clicksTracked: 0 };

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

// **Extraer URLs**
function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
}

// **Generar token**
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
    ip_address: null,
    ...(username && { username })
  };

  const { error } = await supabaseService.from('short_links').insert([dataToInsert]);
  if (error) {
    console.error(`❌ Error al guardar enlace: ${error.message}`);
    return null;
  }
  stats.clicksTracked++;
  return { shortId, token };
}

// **Dividir mensaje en eventos deportivos**
function splitIntoEvents(text) {
  const lines = text.split('\n');
  const events = [];
  let currentEvent = { text: [], urls: [] };
  const urlRegex = /(https?:\/\/[^\s]+)/g;

  lines.forEach(line => {
    if (/^\d{2}:\d{2}/.test(line.trim())) {
      if (currentEvent.text.length) events.push(currentEvent);
      currentEvent = { text: [line], urls: [] };
    } else {
      const urlsInLine = line.match(urlRegex) || [];
      currentEvent.urls.push(...urlsInLine);
      currentEvent.text.push(line.replace(urlRegex, '').trim());
    }
  });

  if (currentEvent.text.length) events.push(currentEvent);
  return events;
}

// **Estructurar mensaje con enlaces acortados**
async function structureMessage(events, messageId, chatId, userId, username) {
  const allShortLinks = [];

  for (const event of events) {
    const shortLinks = [];
    for (const url of event.urls) {
      const shortLink = await shortenUrl(url, messageId, chatId, userId, username);
      if (shortLink) {
        const { shortId, token } = shortLink;
        const callbackData = `click:${shortId}:${token}`;
        shortLinks.push({ url, shortId, token, callbackData });
      }
    }
    event.shortLinks = shortLinks;
    allShortLinks.push(...shortLinks);
  }

  return { events, allShortLinks };
}

// **Verificar administrador**
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
  const threadId = msg.message_thread_id?.toString();

  if (!GRUPOS_PREDEFINIDOS[chatId] || threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

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
/banuser <user_id> - (Admins) Bloquear a un usuario.

¡Envía un enlace, foto, video o GIF para empezar! 🚀
  `;
  await bot.sendMessage(channel.chat_id, welcomeMessage, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Procesar mensajes**
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id?.toString();

  if (!GRUPOS_PREDEFINIDOS[chatId] || threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const userId = msg.from.id.toString();
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

  if (bannedUsers.has(userId)) {
    const channel = CANALES_ESPECIFICOS[chatId];
    await bot.sendMessage(channel.chat_id, `🚫 Lo siento, ${username}, has sido bloqueado por compartir contenido exclusivo.`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
    return;
  }

  const text = sanitizeText(msg.text || msg.caption);
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  if (msg.text?.startsWith('/') || (!text && !photo && !video && !animation)) return;

  const channel = CANALES_ESPECIFICOS[chatId];
  const loadingMsg = await bot.sendMessage(channel.chat_id, '⏳ Generando publicación...', { message_thread_id: channel.thread_id });

  const events = splitIntoEvents(text);
  const { events: structuredEvents } = await structureMessage(events, loadingMsg.message_id, chatId, userId, username);

  try {
    await bot.deleteMessage(channel.chat_id, loadingMsg.message_id);

    for (const event of structuredEvents) {
      const eventText = event.text.join('\n');
      const shortLinks = event.shortLinks;

      let formattedText = eventText;
      shortLinks.forEach((link, index) => {
        const phraseIndex = index % CUSTOM_PHRASES.length;
        formattedText = formattedText.replace(link.url, CUSTOM_PHRASES[phraseIndex]);
      });

      const messageText = `
**${formattedText.trim()}**
${SIGNATURE}
${WARNING_MESSAGE}
      `;

      const inlineKeyboard = shortLinks.map((link, index) => [{ text: `🔗 Abrir enlace ${index + 1}`, callback_data: link.callbackData }]);

      let sentMessage;
      if (photo) {
        sentMessage = await bot.sendPhoto(channel.chat_id, photo, {
          caption: messageText,
          message_thread_id: channel.thread_id,
          parse_mode: 'Markdown',
          protect_content: true,
          reply_markup: inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined
        });
      } else if (video) {
        sentMessage = await bot.sendVideo(channel.chat_id, video, {
          caption: messageText,
          message_thread_id: channel.thread_id,
          parse_mode: 'Markdown',
          protect_content: true,
          reply_markup: inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined
        });
      } else if (animation) {
        sentMessage = await bot.sendAnimation(channel.chat_id, animation, {
          caption: messageText,
          message_thread_id: channel.thread_id,
          parse_mode: 'Markdown',
          protect_content: true,
          reply_markup: inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined
        });
      } else {
        sentMessage = await bot.sendMessage(channel.chat_id, messageText, {
          message_thread_id: channel.thread_id,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          protect_content: true,
          reply_markup: inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined
        });
      }
      messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: messageText });
    }
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
    const [action, shortId, token] = callbackData.split(':');
    if (action !== 'click' || !shortId || !token) {
      return bot.answerCallbackQuery(callbackQueryId, { text: 'Error: Enlace inválido.' });
    }

    const { data: linkData, error } = await supabaseAnon
      .from('short_links')
      .select('original_url')
      .eq('id', shortId)
      .single();

    if (error || !linkData) {
      return bot.answerCallbackQuery(callbackQueryId, { text: 'Error: Enlace no encontrado o expirado.' });
    }

    const originalUrl = linkData.original_url;

    const { error: clickError } = await supabaseService.from('clicks').insert({
      short_code: shortId,
      username: username,
      clicked_at: new Date().toISOString(),
    });

    if (clickError) console.error('Error al registrar clic:', clickError);

    const redirectToken = require('crypto').randomBytes(16).toString('hex');
    const redirectUrl = `${REDIRECT_BASE_URL}${shortId}?token=${redirectToken}`;

    await bot.answerCallbackQuery(callbackQueryId, {
      text: 'Enlace procesado. Haz clic en el botón para continuar.',
      show_alert: true,
    });

    const redirectMessage = await bot.sendMessage(chatId, `${username}, haz clic para ver el contenido:`, {
      reply_to_message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Abrir enlace', url: redirectUrl }]] }
    });

    setTimeout(async () => {
      try {
        await bot.deleteMessage(chatId, redirectMessage.message_id);
      } catch (error) {
        console.error(`❌ Error al eliminar mensaje: ${error.message}`);
      }
    }, 10* 1000);
  } catch (error) {
    console.error('Error en callback:', error);
    await bot.sendMessage(chatId, 'Ocurrió un error al procesar el enlace.');
  }
});

// **Detectar reenvíos**
bot.on('message', async (msg) => {
  if (!msg.forward_from && !msg.forward_from_chat && !msg.forward_from_message_id) return;

  const chatId = msg.chat.id.toString();
  if (!GRUPOS_PREDEFINIDOS[chatId]) return;

  const forwardedMessageId = msg.forward_from_message_id;
  const userId = msg.from.id.toString();
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
  const channel = CANALES_ESPECIFICOS[chatId];

  if (!messageOrigins.has(forwardedMessageId)) return;

  const currentCount = (forwardCounts.get(userId) || 0) + 1;
  forwardCounts.set(userId, currentCount);

  if (currentCount > 3) {
    bannedUsers.add(userId);
    await bot.sendMessage(channel.chat_id, `🚫 ${username} bloqueado por reenvíos repetidos.`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }

  await bot.sendMessage(channel.chat_id, `🚨 ${username} reenvió un mensaje exclusivo a ${msg.chat.title || msg.chat.id}!`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });

  try {
    await bot.deleteMessage(msg.chat.id, msg.message_id);
  } catch (error) {
    console.error(`❌ No se pudo eliminar mensaje: ${error.message}`);
  }

  const { error } = await supabaseService.from('interactions').insert([{
    type: 'forward',
    chat_id: chatId,
    message_id: forwardedMessageId,
    user_id: userId,
    username,
    timestamp: new Date().toISOString(),
    details: `Reenviado a: ${msg.chat.id}`
  }]);
  if (error) console.error(`❌ Error al registrar reenvío: ${error.message}`);
  stats.forwardsDetected++;
});

// **Comando /visto**
bot.onText(/\/visto/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id?.toString();

  if (!GRUPOS_PREDEFINIDOS[chatId] || threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const channel = CANALES_ESPECIFICOS[chatId];
  const { data, error } = await supabaseAnon
    .from('interactions')
    .select('*')
    .eq('chat_id', chatId);

  if (error || !data.length) {
    return bot.sendMessage(channel.chat_id, error ? '⚠️ Error al obtener interacciones.' : '📊 No hay interacciones registradas.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }

  let response = '<b>📊 Interacciones:</b>\n\n';
  data.forEach(r => {
    response += `<b>ID:</b> ${r.message_id}\n<b>Acción:</b> ${r.type}\n<b>Usuario:</b> ${r.username || 'Desconocido'}\n<b>Hora:</b> ${new Date(r.timestamp).toLocaleString('es-ES')}\n<b>Detalles:</b> ${r.details}\n\n`;
  });
  await bot.sendMessage(channel.chat_id, response, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Comando /clics**
bot.onText(/\/clics/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id?.toString();

  if (!GRUPOS_PREDEFINIDOS[chatId] || threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const channel = CANALES_ESPECIFICOS[chatId];
  const { data, error } = await supabaseAnon.from('clicks').select('*');

  if (error || !data.length) {
    return bot.sendMessage(channel.chat_id, error ? '⚠️ Error al obtener clics.' : '📊 No hay clics registrados.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }

  let response = '<b>📊 Clics:</b>\n\n';
  data.forEach(r => {
    response += `<b>ID:</b> ${r.id}\n<b>Short Code:</b> ${r.short_code}\n<b>Usuario:</b> ${r.username || 'Desconocido'}\n<b>Hora:</b> ${new Date(r.clicked_at).toLocaleString('es-ES')}\n\n`;
  });
  await bot.sendMessage(channel.chat_id, response, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Comando /stats**
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id?.toString();

  if (!GRUPOS_PREDEFINIDOS[chatId] || threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

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

// **Comando /banuser**
bot.onText(/\/banuser (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id?.toString();

  if (!GRUPOS_PREDEFINIDOS[chatId] || threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return;

  const userId = msg.from.id;
  const targetUserId = match[1];
  const channel = CANALES_ESPECIFICOS[chatId];

  if (!await isAdmin(chatId, userId)) {
    return bot.sendMessage(channel.chat_id, '🚫 Solo administradores pueden usar este comando.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }

  bannedUsers.add(targetUserId);
  await bot.sendMessage(channel.chat_id, `🚫 Usuario ${targetUserId} bloqueado.`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Ruta webhook**
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// **Ruta redirección**
app.get('/redirect/:shortId', async (req, res) => {
  const { shortId } = req.params;
  const { token } = req.query;

  const { data: linkData, error } = await supabaseAnon
    .from('short_links')
    .select('original_url, expires_at')
    .eq('id', shortId)
    .single();

  if (error || !linkData || new Date() > new Date(linkData.expires_at)) {
    return res.status(error ? 500 : 410).send(error ? 'Error interno.' : 'Enlace expirado.');
  }

  res.redirect(linkData.original_url);
});

// **Iniciar servidor**
app.listen(PORT, async () => {
  console.log(`✅ Servidor en puerto ${PORT}`);
  await bot.setWebHook(WEBHOOK_URL);
});