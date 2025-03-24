const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const shortid = require('shortid');
const crypto = require('crypto');

// Configuración de logging
console.log('🚀 Iniciando el bot EntresHijos...');

// Token del bot
const TOKEN = '7624808452:AAHffFqqhaXtun4XthusBfeeeVDcp6Qsrs4';

// Firma con emojis (permanente en todos los mensajes)
const SIGNATURE = '\n\n✨ EntresHijos ✨';

// Advertencia para no compartir
const WARNING_MESSAGE = '\n⚠️ Este mensaje es exclusivo para este grupo. No lo compartas para proteger el contenido.';

// Configuración del servidor webhook
const PORT = process.env.PORT || 8443;
const WEBHOOK_URL = 'https://entreboton.onrender.com/webhook';
const REDIRECT_BASE_URL = 'https://entreboton.onrender.com/redirect/';

// Configuración de Supabase (usando variables de entorno)
const SUPABASE_URL = 'https://ycvkdxzxrzuwnkybmjwf.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljdmtkeHp4cnp1d25reWJtandmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI4Mjg4NzYsImV4cCI6MjA1ODQwNDg3Nn0.1ts8XIpysbMe5heIg3oWLfqKxReusZxemw4lk2WZ4GI';

// Cliente de Supabase con permisos anónimos (para operaciones generales)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Mapa para almacenar orígenes de mensajes
const messageOrigins = new Map();

// Lista de usuarios bloqueados (almacenada en memoria, podrías moverla a Supabase para persistencia)
const bannedUsers = new Set();

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

// **Extraer URLs**
function extractUrls(msg) {
  const text = msg.text || msg.caption || '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let urls = text.match(urlRegex) || [];
  const entities = msg.entities || msg.caption_entities || [];
  const entityUrls = entities.filter(e => e.type === 'url').map(e => text.substr(e.offset, e.length));
  return [...new Set([...urls, ...entityUrls])];
}

// **Generar token para autenticación**
function generateToken(userId, shortId) {
  const secret = process.env.TOKEN_SECRET || 'tu-clave-secreta-aqui-32-caracteres'; // Usa una variable de entorno para mayor seguridad
  return crypto.createHmac('sha256', secret).update(`${userId}-${shortId}`).digest('hex');
}

// **Acortar URL y almacenar en Supabase**
async function shortenUrl(originalUrl, messageId, chatId, userId, expiryHours = 24) {
  const shortId = shortid.generate();
  const token = generateToken(userId, shortId);
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('short_links').insert([{
    id: shortId,
    original_url: originalUrl,
    message_id: messageId,
    chat_id: chatId,
    user_id: userId,
    token,
    expires_at: expiresAt
  }]);
  if (error) {
    console.error(`❌ Error al guardar enlace acortado: ${error.message}`);
    return null;
  }
  stats.clicksTracked++;
  return `${REDIRECT_BASE_URL}${shortId}?token=${token}`;
}

// **Estructurar mensaje con enlaces acortados**
async function structureMessage(text, urls, messageId, chatId, userId) {
  if (!text) return { formattedText: '', urlPositions: [] };
  let formattedText = text;
  const urlPositions = [];
  for (let i = 0; i < urls.length; i++) {
    const shortUrl = await shortenUrl(urls[i], messageId, chatId, userId);
    if (shortUrl) {
      formattedText = formattedText.replace(urls[i], `<a href="${shortUrl}">🔗 Enlace ${i + 1}</a>`);
      urlPositions.push({ url: urls[i], shortUrl });
    }
  }
  return { formattedText, urlPositions };
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
  const chatId = msg.chat.id;
  const welcomeMessage = `
<b>¡Bienvenido a EntresHijos! ✨</b>

Soy un bot diseñado para proteger el contenido exclusivo de este grupo. Aquí tienes algunas cosas que puedo hacer:

📌 <b>Proteger enlaces:</b> Convierto los enlaces en enlaces acortados y protegidos que expiran después de 24 horas.
📸 <b>Proteger multimedia:</b> Evito que las fotos, videos y GIFs sean reenviados.
🚨 <b>Detectar reenvíos:</b> Si alguien reenvía un mensaje exclusivo, lo detectaré y notificaré al grupo.
📊 <b>Ver interacciones:</b> Usa /visto para ver quién ha interactuado con los mensajes.

<b>Comandos útiles:</b>
/visto - Ver interacciones (reenvíos y clics).
/stats - Ver estadísticas del bot.
/banuser <user_id> - (Admins) Bloquear a un usuario para que no pueda reenviar mensajes.

¡Envía un enlace, foto, video o GIF para empezar! 🚀
  `;
  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML' });
});

// **Procesar mensajes**
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  // Verificar si el usuario está bloqueado
  if (bannedUsers.has(userId)) {
    await bot.sendMessage(chatId, `🚫 Lo siento, ${msg.from.first_name}, has sido bloqueado por compartir contenido exclusivo. Contacta a un administrador para resolver esto.`, { parse_mode: 'HTML' });
    return;
  }

  const text = sanitizeText(msg.text || msg.caption);
  const urls = extractUrls(msg);
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  if (msg.text && msg.text.startsWith('/')) return; // Ignorar comandos
  if (!urls.length && !photo && !video && !animation) return;

  const loadingMsg = await bot.sendMessage(chatId, '⏳ Generando publicación...');
  const { formattedText } = await structureMessage(text, urls, loadingMsg.message_id, chatId, userId);
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
    stats.messagesProcessed++;
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
    await bot.sendMessage(msg.chat.id, `🚫 Mensaje eliminado por compartir contenido exclusivo, ${userName}.`, { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`❌ No se pudo eliminar el mensaje: ${error.message}`);
  }

  // Registrar en Supabase
  const { error } = await supabase.from('interactions').insert([{
    type: 'forward',
    chat_id: originalChatId,
    message_id: forwardedMessageId,
    user_id: forwardedByUser.id.toString(),
    username: userName,
    timestamp: new Date().toISOString(),
    details: `Reenviado a: ${msg.chat.id}`
  }]);
  if (error) console.error(`❌ Error al registrar reenvío: ${error.message}`);
  stats.forwardsDetected++;
});

// **Manejar clics en enlaces**
app.get('/redirect/:shortId', async (req, res) => {
  const { shortId } = req.params;
  const { token } = req.query;

  const { data, error } = await supabase.from('short_links').select('*').eq('id', shortId).single();
  if (error || !data) return res.status(404).send('Enlace no encontrado');

  const { original_url, user_id, token: storedToken, expires_at } = data;

  if (new Date() > new Date(expires_at)) {
    return res.status(403).send('Enlace expirado');
  }

  if (token !== storedToken) {
    return res.status(403).send('Token inválido');
  }

  // Registrar clic
  await supabase.from('interactions').insert([{
    type: 'click',
    chat_id: data.chat_id,
    message_id: data.message_id,
    user_id,
    username: 'known', // Podrías mejorar esto si tienes el username disponible
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

// **Comando /stats**
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const statsMessage = `
<b>📈 Estadísticas de EntresHijos:</b>

📩 <b>Mensajes procesados:</b> ${stats.messagesProcessed}
🚨 <b>Reenvíos detectados:</b> ${stats.forwardsDetected}
🔗 <b>Clics rastreados:</b> ${stats.clicksTracked}
🚫 <b>Usuarios bloqueados:</b> ${bannedUsers.size}

¡Gracias por usar EntresHijos! ✨
  `;
  await bot.sendMessage(chatId, statsMessage, { parse_mode: 'HTML' });
});

// **Comando /banuser (solo para administradores)**
bot.onText(/\/banuser (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const targetUserId = match[1];

  // Verificar si el usuario es administrador
  const isUserAdmin = await isAdmin(chatId, userId);
  if (!isUserAdmin) {
    await bot.sendMessage(chatId, '🚫 Solo los administradores pueden usar este comando.', { parse_mode: 'HTML' });
    return;
  }

  bannedUsers.add(targetUserId);
  await bot.sendMessage(chatId, `🚫 El usuario con ID ${targetUserId} ha sido bloqueado y no podrá reenviar mensajes.`, { parse_mode: 'HTML' });
});

// **Configurar webhook y arrancar**
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.listen(PORT, async () => {
  console.log(`✅ Servidor en puerto ${PORT}`);
  await bot.setWebHook(WEBHOOK_URL);
});