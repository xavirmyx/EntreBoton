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
function generateToken(userId, shortId, ipAddress) {
  const secret = process.env.TOKEN_SECRET || 'tu-clave-secreta-aqui-32-caracteres'; // Usa una variable de entorno para mayor seguridad
  return crypto.createHmac('sha256', secret).update(`${userId}-${shortId}-${ipAddress}`).digest('hex');
}

// **Acortar URL y almacenar en Supabase**
async function shortenUrl(originalUrl, messageId, chatId, userId, username, expiryHours = 24) {
  const shortId = shortid.generate();
  const token = generateToken(userId, shortId, 'initial'); // Token inicial, se actualizará con la IP al hacer clic
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

  const dataToInsert = {
    id: shortId,
    original_url: originalUrl,
    message_id: messageId,
    chat_id: chatId,
    user_id: userId,
    token,
    expires_at: expiresAt,
    ip_address: null // Se actualizará al hacer clic
  };

  // Solo añadir el campo username si está definido
  if (username) {
    dataToInsert.username = username;
  }

  const { error } = await supabase.from('short_links').insert([dataToInsert]);
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

// **Estructurar mensaje con enlaces acortados**
async function structureMessage(text, urls, messageId, chatId, userId, username) {
  if (!text && !urls.length) return { formattedText: '', urlPositions: [] };
  let formattedText = text || '';
  const urlPositions = [];

  console.log(`📝 Procesando ${urls.length} enlaces...`);

  // Procesar todos los enlaces en paralelo
  const shortLinksPromises = urls.map(async (url, i) => {
    const shortLink = await shortenUrl(url, messageId, chatId, userId, username);
    if (shortLink) {
      const { shortId, token } = shortLink;
      const shortUrl = `${REDIRECT_BASE_URL}${shortId}?token=${token}`;
      return { index: i, url, shortUrl };
    }
    console.warn(`⚠️ No se pudo acortar el enlace: ${url}`);
    return null;
  });

  const shortLinks = (await Promise.all(shortLinksPromises)).filter(link => link !== null);

  // Reemplazar los enlaces en el texto
  for (const { url, shortUrl, index } of shortLinks) {
    formattedText = formattedText.replace(url, `<a href="${shortUrl}">🔗 Enlace ${index + 1}</a>`);
    urlPositions.push({ url, shortUrl });
  }

  console.log(`✅ ${shortLinks.length} enlaces acortados y reemplazados en el texto.`);
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
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return; // Ignorar si no es el grupo permitido
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return; // Ignorar si no es el canal específico

  const channel = CANALES_ESPECIFICOS[chatId];
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
  await bot.sendMessage(channel.chat_id, welcomeMessage, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Procesar mensajes**
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return; // Ignorar si no es el grupo permitido
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return; // Ignorar si no es el canal específico

  const userId = msg.from.id.toString();
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

  // Verificar si el usuario está bloqueado
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

  if (msg.text && msg.text.startsWith('/')) return; // Ignorar comandos
  if (!urls.length && !photo && !video && !animation) return;

  const channel = CANALES_ESPECIFICOS[chatId];
  const loadingMsg = await bot.sendMessage(channel.chat_id, '⏳ Generando publicación...', { message_thread_id: channel.thread_id });

  // Procesar enlaces si existen
  let caption = text || '📢 Publicación';
  if (urls.length) {
    const { formattedText } = await structureMessage(text, urls, loadingMsg.message_id, chatId, userId, username);
    caption = formattedText || '📢 Publicación';
  }
  caption += `${SIGNATURE}${WARNING_MESSAGE}`;

  try {
    // Dividir el mensaje en partes si es necesario
    const messageParts = splitMessage(caption);
    let sentMessage;

    if (photo) {
      await bot.deleteMessage(channel.chat_id, loadingMsg.message_id, { message_thread_id: channel.thread_id });
      // Enviar la imagen con la primera parte de la descripción
      sentMessage = await bot.sendPhoto(channel.chat_id, photo, { caption: messageParts[0], message_thread_id: channel.thread_id, parse_mode: 'HTML', protect_content: true });
      // Enviar las partes restantes como mensajes de texto
      for (let i = 1; i < messageParts.length; i++) {
        await bot.sendMessage(channel.chat_id, messageParts[i], { message_thread_id: channel.thread_id, parse_mode: 'HTML', protect_content: true });
      }
    } else if (video) {
      await bot.deleteMessage(channel.chat_id, loadingMsg.message_id, { message_thread_id: channel.thread_id });
      sentMessage = await bot.sendVideo(channel.chat_id, video, { caption: messageParts[0], message_thread_id: channel.thread_id, parse_mode: 'HTML', protect_content: true });
      for (let i = 1; i < messageParts.length; i++) {
        await bot.sendMessage(channel.chat_id, messageParts[i], { message_thread_id: channel.thread_id, parse_mode: 'HTML', protect_content: true });
      }
    } else if (animation) {
      await bot.deleteMessage(channel.chat_id, loadingMsg.message_id, { message_thread_id: channel.thread_id });
      sentMessage = await bot.sendAnimation(channel.chat_id, animation, { caption: messageParts[0], message_thread_id: channel.thread_id, parse_mode: 'HTML', protect_content: true });
      for (let i = 1; i < messageParts.length; i++) {
        await bot.sendMessage(channel.chat_id, messageParts[i], { message_thread_id: channel.thread_id, parse_mode: 'HTML', protect_content: true });
      }
    } else {
      await bot.deleteMessage(channel.chat_id, loadingMsg.message_id, { message_thread_id: channel.thread_id });
      // Enviar todas las partes como mensajes de texto
      sentMessage = await bot.sendMessage(channel.chat_id, messageParts[0], { message_thread_id: channel.thread_id, parse_mode: 'HTML', disable_web_page_preview: true, protect_content: true });
      for (let i = 1; i < messageParts.length; i++) {
        await bot.sendMessage(channel.chat_id, messageParts[i], { message_thread_id: channel.thread_id, parse_mode: 'HTML', disable_web_page_preview: true, protect_content: true });
      }
    }
    messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
    stats.messagesProcessed++;
  } catch (error) {
    console.error(`❌ Error al procesar mensaje: ${error.message}`);
    await bot.editMessageText('⚠️ Error al generar publicación.', { chat_id: channel.chat_id, message_id: loadingMsg.message_id, message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }
});

// **Detectar y manejar reenvíos**
bot.on('message', async (msg) => {
  if (!msg.forward_from && !msg.forward_from_chat && !msg.forward_from_message_id) return;

  const chatId = msg.chat.id.toString();
  if (!GRUPOS_PREDEFINIDOS[chatId]) return; // Ignorar si no es el grupo permitido

  const forwardedMessageId = msg.forward_from_message_id;
  const forwardedByUser = msg.from;
  const userId = forwardedByUser.id.toString();
  const username = forwardedByUser.username ? `@${forwardedByUser.username}` : forwardedByUser.first_name;

  // Verificar si el mensaje reenviado fue generado por el bot
  const forwardedFrom = msg.forward_from || msg.forward_from_chat;
  const isBotMessage = forwardedFrom && forwardedFrom.id === bot.id;

  if (!messageOrigins.has(forwardedMessageId) && !isBotMessage) return;

  const origin = messageOrigins.get(forwardedMessageId) || { chat_id: chatId };
  const originalChatId = origin.chat_id;
  const channel = CANALES_ESPECIFICOS[originalChatId];

  // Incrementar contador de reenvíos del usuario
  const currentCount = (forwardCounts.get(userId) || 0) + 1;
  forwardCounts.set(userId, currentCount);

  // Bloquear automáticamente si el usuario reenvía más de 3 veces
  if (currentCount > 3) {
    bannedUsers.add(userId);
    await bot.sendMessage(channel.chat_id, `🚫 ${username} ha sido bloqueado automáticamente por reenviar mensajes exclusivos repetidamente.`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }

  // Advertencia en chat original
  await bot.sendMessage(channel.chat_id, `🚨 ${username} reenvió un mensaje exclusivo a ${msg.chat.title || msg.chat.id}!`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });

  // Intentar eliminar mensaje reenviado
  try {
    await bot.deleteMessage(msg.chat.id, msg.message_id);
    await bot.sendMessage(msg.chat.id, `🚫 Mensaje eliminado por compartir contenido exclusivo, ${username}.`, { parse_mode: 'HTML' });
  } catch (error) {
    console.error(`❌ No se pudo eliminar el mensaje: ${error.message}`);
  }

  // Registrar en Supabase
  const { error } = await supabase.from('interactions').insert([{
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

// **Manejar clics en enlaces**
app.get('/redirect/:shortId', async (req, res) => {
  const { shortId } = req.params;
  const { token } = req.query;
  const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  const { data, error } = await supabase.from('short_links').select('*').eq('id', shortId).single();
  if (error || !data) {
    console.error(`❌ Error al buscar enlace acortado: ${error?.message || 'No encontrado'}`);
    return res.status(404).send('Enlace no encontrado');
  }

  const { original_url, user_id, username, token: storedToken, expires_at, ip_address } = data;

  if (new Date() > new Date(expires_at)) {
    return res.status(403).send('Enlace expirado');
  }

  // Verificar IP (si ya se registró una IP, debe coincidir)
  if (ip_address && ip_address !== ipAddress) {
    return res.status(403).send('Acceso denegado: IP no autorizada');
  }

  // Verificar token
  const expectedToken = generateToken(user_id, shortId, ipAddress);
  if (token !== storedToken && token !== expectedToken) {
    return res.status(403).send('Token inválido');
  }

  // Actualizar IP y token si es la primera vez
  if (!ip_address) {
    const { error: updateError } = await supabase.from('short_links').update({ ip_address: ipAddress, token: expectedToken }).eq('id', shortId);
    if (updateError) {
      console.error(`❌ Error al actualizar IP en enlace acortado: ${updateError.message}`);
    } else {
      console.log(`✅ IP actualizada en enlace acortado: ${shortId}`);
    }
  }

  // Registrar clic
  const { error: insertError } = await supabase.from('interactions').insert([{
    type: 'click',
    chat_id: data.chat_id,
    message_id: data.message_id,
    user_id,
    username,
    timestamp: new Date().toISOString(),
    details: `Clic en: ${original_url} desde IP: ${ipAddress}`
  }]);
  if (insertError) {
    console.error(`❌ Error al registrar clic: ${insertError.message}`);
  } else {
    console.log(`✅ Clic registrado en Supabase: ${username} hizo clic en ${original_url}`);
  }

  res.redirect(original_url);
});

// **Comando /visto**
bot.onText(/\/visto/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return; // Ignorar si no es el grupo permitido
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return; // Ignorar si no es el canal específico

  const channel = CANALES_ESPECIFICOS[chatId];
  const { data, error } = await supabase.from('interactions').select('*').eq('chat_id', chatId);
  if (error) {
    console.error(`❌ Error al obtener interacciones: ${error.message}`);
    return bot.sendMessage(channel.chat_id, '⚠️ Error al obtener interacciones.', { message_thread_id: channel.thread_id });
  }

  if (!data.length) return bot.sendMessage(channel.chat_id, '📊 No hay interacciones registradas.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  let response = '<b>📊 Interacciones:</b>\n\n';
  data.forEach(r => {
    response += `<b>ID:</b> ${r.message_id}\n<b>Acción:</b> ${r.type}\n<b>Usuario:</b> ${r.username || 'Desconocido'}\n<b>Hora:</b> ${new Date(r.timestamp).toLocaleString('es-ES')}\n<b>Detalles:</b> ${r.details}\n\n`;
  });
  await bot.sendMessage(channel.chat_id, response, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
});

// **Comando /stats**
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return; // Ignorar si no es el grupo permitido
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return; // Ignorar si no es el canal específico

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

  if (!GRUPOS_PREDEFINIDOS[chatId]) return; // Ignorar si no es el grupo permitido
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) return; // Ignorar si no es el canal específico

  const userId = msg.from.id;
  const targetUserId = match[1];
  const channel = CANALES_ESPECIFICOS[chatId];

  // Verificar si el usuario es administrador
  const isUserAdmin = await isAdmin(chatId, userId);
  if (!isUserAdmin) {
    await bot.sendMessage(channel.chat_id, '🚫 Solo los administradores pueden usar este comando.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
    return;
  }

  bannedUsers.add(targetUserId);
  await bot.sendMessage(channel.chat_id, `🚫 El usuario con ID ${targetUserId} ha sido bloqueado y no podrá reenviar mensajes.`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
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