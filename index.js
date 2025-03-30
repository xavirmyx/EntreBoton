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
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljdmtkeHp4crp1d25reWJtandmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MjgyODg3NiwiZXhwIjoyMDU4NDA0ODc2fQ.q1234567890abcdefghij';

// Cliente de Supabase con permisos anónimos (para operaciones de lectura)
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Cliente de Supabase con permisos de service_role (para operaciones de escritura)
const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Verificación inicial de los clientes de Supabase
(async () => {
  try {
    const { data, error } = await supabaseAnon.from('short_links').select('id').limit(1);
    if (error) throw error;
    console.log('✅ Conexión con Supabase (anon) establecida correctamente.');
  } catch (error) {
    console.error('❌ Error al conectar con Supabase (anon):', error.message);
  }

  try {
    const { data, error } = await supabaseService.from('short_links').select('id').limit(1);
    if (error) throw error;
    console.log('✅ Conexión con Supabase (service) establecida correctamente.');
  } catch (error) {
    console.error('❌ Error al conectar con Supabase (service):', error.message);
  }
})();

// Configuración de grupos y canales específicos
const GRUPOS_PREDEFINIDOS = { '-1002348662107': 'GLOBAL SPORTS STREAM' };
const CANALES_ESPECIFICOS = { '-1002348662107': { chat_id: '-1002348662107', thread_id: '47899' } };

// Mapa para almacenar orígenes de mensajes
const messageOrigins = new Map();

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

// **Extraer URLs únicas (evitar duplicados)**
function extractUrls(msg) {
  const text = msg.text || msg.caption || '';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = new Set(); // Usamos Set para evitar duplicados
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    urls.add(match[0]);
  }
  const entities = msg.entities || msg.caption_entities || [];
  entities.filter(e => e.type === 'url').forEach(e => urls.add(text.substr(e.offset, e.length)));
  return Array.from(urls); // Convertimos el Set a Array
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

// **Estructurar mensaje con enlaces acortados (reemplazando URLs por frases personalizadas)**
async function structureMessage(text, urls, messageId, chatId, userId, username) {
  if (!text && !urls.length) return { formattedText: '', shortLinks: [] };

  let formattedText = text || '📢 Publicación';
  const shortLinks = [];
  const urlMap = new Map(); // Para rastrear URLs únicas y sus reemplazos

  console.log(`📝 URLs detectadas (únicas): ${urls}`);
  console.log(`📝 Texto original: ${text}`);

  const shortLinksPromises = urls.map(async (url, index) => {
    const shortLink = await shortenUrl(url, messageId, chatId, userId, username);
    if (shortLink) {
      const { shortId, token } = shortLink;
      const callbackData = `click:${shortId}:${token}`;
      const phraseIndex = index % CUSTOM_PHRASES.length;
      const replacementPhrase = CUSTOM_PHRASES[phraseIndex];
      urlMap.set(url, { shortId, token, callbackData, replacementPhrase });
      return { url, shortId, token, callbackData, replacementPhrase };
    }
    console.warn(`⚠️ No se pudo acortar el enlace: ${url}`);
    return null;
  });

  const results = (await Promise.all(shortLinksPromises)).filter(link => link !== null);

  // Reemplazar cada URL en el texto original con su frase correspondiente
  let currentText = formattedText;
  for (const [url, { replacementPhrase }] of urlMap) {
    currentText = currentText.split(url).join(replacementPhrase); // Reemplazo exacto
  }
  formattedText = currentText;
  shortLinks.push(...results);

  console.log(`✅ ${results.length} enlaces acortados únicos.`);
  console.log(`📝 Texto formateado: ${formattedText}`);
  return { formattedText, shortLinks };
}

// **Verificar si el usuario es administrador**
async function isAdmin(chatId, userId) {
  try {
    console.log(`🔍 Verificando si ${userId} es administrador en ${chatId}`);
    const admins = await bot.getChatAdministrators(chatId);
    if (!admins || !Array.isArray(admins)) {
      console.error('❌ Respuesta inválida de getChatAdministrators:', admins);
      return false;
    }
    const isAdminUser = admins.some(member => member.user.id === userId);
    console.log(`✅ Resultado de verificación: ${isAdminUser}`);
    return isAdminUser;
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
  const originalMessageId = msg.message_id; // Guardar el ID del mensaje original

  const channel = CANALES_ESPECIFICOS[chatId];

  const text = sanitizeText(msg.text || msg.caption);
  const urls = extractUrls(msg);
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  if (msg.text && msg.text.startsWith('/')) return;
  if (!urls.length && !photo && !video && !animation) return;

  const loadingMsg = await bot.sendMessage(channel.chat_id, '⏳ Generando publicación...', { message_thread_id: channel.thread_id });

  try {
    // Dividir el texto en bloques de eventos basados en líneas de tiempo (formato "HH:MM")
    const lines = text.split('\n').filter(line => line.trim());
    const eventBlocks = [];
    let currentBlock = { title: '', urls: [] };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.match(/^\d{2}:\d{2}/)) {
        if (currentBlock.title || currentBlock.urls.length) {
          eventBlocks.push(currentBlock);
        }
        currentBlock = { title: line, urls: [] };
      } else if (line.match(/^https?:\/\//)) {
        currentBlock.urls.push(line);
      } else {
        currentBlock.title += `\n${line}`;
      }
    }

    if (currentBlock.title || currentBlock.urls.length) {
      eventBlocks.push(currentBlock);
    }

    const allUrls = urls;
    const { formattedText: fullText, shortLinks } = await structureMessage(text, allUrls, loadingMsg.message_id, chatId, userId, username);
    const urlToShortLink = new Map(shortLinks.map(link => [link.url, link]));

    const messagesToSend = eventBlocks.map(block => {
      let formattedText = block.title.trim();
      const blockUrls = block.urls.filter(url => urlToShortLink.has(url));
      const blockShortLinks = blockUrls.map(url => urlToShortLink.get(url)).filter(link => link);

      blockUrls.forEach((url, index) => {
        const link = urlToShortLink.get(url);
        if (link) {
          formattedText = formattedText.split(url).join(link.replacementPhrase);
        }
      });

      formattedText += `${SIGNATURE}${WARNING_MESSAGE}`;

      const inlineKeyboard = blockShortLinks.length ? [
        blockShortLinks.map((link, index) => ({
          text: `🔗 Botón ${index + 1}`,
          callback_data: link.callbackData
        }))
      ] : [];

      return {
        text: formattedText,
        inlineKeyboard
      };
    });

    await bot.deleteMessage(channel.chat_id, loadingMsg.message_id);

    // Enviar cada bloque de evento como un mensaje separado
    for (let i = 0; i < messagesToSend.length; i++) {
      const message = messagesToSend[i];
      const messageParts = splitMessage(message.text);
      let sentMessage;

      if (i === 0 && (photo || video || animation)) {
        if (photo) {
          sentMessage = await bot.sendPhoto(channel.chat_id, photo, {
            caption: messageParts[0],
            message_thread_id: channel.thread_id,
            parse_mode: 'HTML',
            protect_content: true,
            reply_markup: message.inlineKeyboard.length ? { inline_keyboard: message.inlineKeyboard } : undefined
          });
        } else if (video) {
          sentMessage = await bot.sendVideo(channel.chat_id, video, {
            caption: messageParts[0],
            message_thread_id: channel.thread_id,
            parse_mode: 'HTML',
            protect_content: true,
            reply_markup: message.inlineKeyboard.length ? { inline_keyboard: message.inlineKeyboard } : undefined
          });
        } else if (animation) {
          sentMessage = await bot.sendAnimation(channel.chat_id, animation, {
            caption: messageParts[0],
            message_thread_id: channel.thread_id,
            parse_mode: 'HTML',
            protect_content: true,
            reply_markup: message.inlineKeyboard.length ? { inline_keyboard: message.inlineKeyboard } : undefined
          });
        }

        for (let j = 1; j < messageParts.length; j++) {
          await bot.sendMessage(channel.chat_id, messageParts[j], {
            message_thread_id: channel.thread_id,
            parse_mode: 'HTML',
            protect_content: true
          });
        }
      } else {
        sentMessage = await bot.sendMessage(channel.chat_id, messageParts[0], {
          message_thread_id: channel.thread_id,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          protect_content: true,
          reply_markup: message.inlineKeyboard.length ? { inline_keyboard: message.inlineKeyboard } : undefined
        });

        for (let j = 1; j < messageParts.length; j++) {
          await bot.sendMessage(channel.chat_id, messageParts[j], {
            message_thread_id: channel.thread_id,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            protect_content: true
          });
        }
      }

      messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: message.text });
    }

    // Eliminar el mensaje original después de procesarlo
    await bot.deleteMessage(chatId, originalMessageId);
    console.log(`✅ Mensaje original (ID: ${originalMessageId}) eliminado después de procesar`);
  } catch (error) {
    console.error(`❌ Error al procesar mensaje: ${error.message}`);
    await bot.deleteMessage(channel.chat_id, loadingMsg.message_id);
    await bot.sendMessage(channel.chat_id, '⚠️ Error al generar publicación.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }
});

// **Manejar clics en botones inline**
bot.on('callback_query', async (query) => {
  const callbackQueryId = query.id;
  const callbackData = query.data;
  const username = query.from.username ? `@${query.from.username}` : query.from.first_name;

  const channel = CANALES_ESPECIFICOS['-1002348662107'];

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

    const redirectMessage = await bot.sendMessage(channel.chat_id, `${username}, haz clic para ver el contenido:`, {
      message_thread_id: channel.thread_id,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: 'Abrir enlace', url: redirectUrl }]],
      },
    });

    setTimeout(async () => {
      try {
        await bot.deleteMessage(channel.chat_id, redirectMessage.message_id);
        console.log(`✅ Mensaje "Haz clic para ver el contenido" eliminado después de 5 segundos.`);
      } catch (error) {
        console.error(`❌ Error al eliminar el mensaje de redirección: ${error.message}`);
      }
    }, 5 * 1000);
  } catch (error) {
    console.error('Error al procesar el callback:', error);
    if (error.code === 'ETELEGRAM' && error.response?.body?.description?.includes('query is too old')) {
      await bot.sendMessage(channel.chat_id, '⚠️ Lo siento, el enlace ha expirado. Por favor, intenta de nuevo.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
    } else {
      await bot.sendMessage(channel.chat_id, '⚠️ Ocurrió un error al procesar el enlace. Por favor, intenta de nuevo.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
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
  const username = forwardedByUser.username ? `@${forwardedByUser.username}` : forwardedByUser.first_name;

  const forwardedFrom = msg.forward_from || msg.forward_from_chat;
  const isBotMessage = forwardedFrom && forwardedFrom.id === bot.id;

  if (!messageOrigins.has(forwardedMessageId) && !isBotMessage) return;

  const origin = messageOrigins.get(forwardedMessageId) || { chat_id: chatId };
  const originalChatId = origin.chat_id;
  const channel = CANALES_ESPECIFICOS[originalChatId];

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
    user_id: forwardedByUser.id.toString(),
    username,
    timestamp: new Date().toISOString(),
    details: `Reenviado a: ${msg.chat.id}`
  }]);
  if (error) {
    console.error(`❌ Error al registrar reenvío: ${error.message}`);
  } else {
    console.log(`✅ Reenvío registrado en Supabase: ${username} reenvió mensaje ${forwardedMessageId}`);
  }
});

// **Comando /clean (solo para administradores)**
bot.onText(/\/clean/, async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  console.log(`📝 Procesando /clean - Chat ID: ${chatId}, Thread ID: ${threadId}`);

  if (!GRUPOS_PREDEFINIDOS[chatId]) {
    console.log(`⚠️ Chat ${chatId} no está en GRUPOS_PREDEFINIDOS`);
    return;
  }
  if (threadId !== CANALES_ESPECIFICOS[chatId].thread_id) {
    console.log(`⚠️ Thread ${threadId} no coincide con ${CANALES_ESPECIFICOS[chatId].thread_id}`);
    return;
  }

  const userId = msg.from.id;
  const channel = CANALES_ESPECIFICOS[chatId];

  const isUserAdmin = await isAdmin(chatId, userId);
  if (!isUserAdmin) {
    console.log(`🚫 ${userId} no es administrador en ${chatId}`);
    await bot.sendMessage(channel.chat_id, '🚫 Solo los administradores pueden usar este comando.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
    return;
  }

  try {
    const now = new Date().toISOString();

    const { data: linksToDelete, error: selectError } = await supabaseService
      .from('short_links')
      .select('id, chat_id, expires_at')
      .or(`chat_id.neq.-1002348662107,expires_at.lt.${now}`);

    if (selectError) {
      console.error(`❌ Error al consultar enlaces para eliminar: ${selectError.message}`);
      await bot.sendMessage(channel.chat_id, '⚠️ Error al buscar enlaces para limpiar.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
      return;
    }

    if (!linksToDelete || linksToDelete.length === 0) {
      console.log('✅ No hay enlaces para limpiar (ni fuera del canal ni expirados)');
      await bot.sendMessage(channel.chat_id, '✅ No hay enlaces para limpiar (ni fuera del canal ni expirados).', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
      return;
    }

    const idsToDelete = linksToDelete.map(link => link.id);
    const expiredCount = linksToDelete.filter(link => new Date(link.expires_at) < new Date(now)).length;
    const outsideChannelCount = linksToDelete.filter(link => link.chat_id !== '-1002348662107').length;

    console.log(`🧹 Enlaces a eliminar encontrados: ${idsToDelete.length} (Expirados: ${expiredCount}, Fuera del canal: ${outsideChannelCount})`);

    const { error: deleteError } = await supabaseService
      .from('short_links')
      .delete()
      .in('id', idsToDelete);

    if (deleteError) {
      console.error(`❌ Error al eliminar enlaces: ${deleteError.message}`);
      await bot.sendMessage(channel.chat_id, '⚠️ Error al limpiar enlaces.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
      return;
    }

    console.log(`✅ ${idsToDelete.length} enlaces eliminados de la base de datos`);
    await bot.sendMessage(channel.chat_id, `🧹 Se han eliminado ${idsToDelete.length} enlaces de la base de datos (${expiredCount} expirados, ${outsideChannelCount} fuera del canal).${SIGNATURE}`, { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  } catch (error) {
    console.error(`❌ Error inesperado en /clean: ${error.message}`);
    await bot.sendMessage(channel.chat_id, '⚠️ Ocurrió un error inesperado al limpiar los enlaces.', { message_thread_id: channel.thread_id, parse_mode: 'HTML' });
  }
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