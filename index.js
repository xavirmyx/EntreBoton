const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { customAlphabet } = require('nanoid/async'); // Cambiamos a nanoid/async
const rateLimit = require('express-rate-limit');

// Configuración de logging
console.log('🚀 Iniciando el bot EntresHijos...');

// Token del bot
const TOKEN = process.env.TELEGRAM_TOKEN || '7624808452:AAHffFqqhaXtun4XthusBfeeeVDcp6Qsrs4';

// Firma con emojis (permanente en todos los mensajes)
const SIGNATURE = '\n\n✨ EntresHijos ✨';

// Advertencia para no compartir ni hacer capturas
const WARNING_MESSAGE = '\n⚠️ Este mensaje es exclusivo para este grupo. No lo copies, reenvíes ni hagas capturas de pantalla para proteger el contenido.';

// Intervalo para limpieza automática (en milisegundos, ej. cada 6 horas)
const AUTO_CLEAN_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas

// Intervalo para limpieza de messageOrigins (cada hora)
const MESSAGE_ORIGINS_CLEAN_INTERVAL = 60 * 60 * 1000; // 1 hora

// Configuración del servidor webhook
const PORT = process.env.PORT || 3000; // Usamos el puerto dinámico de Render
const WEBHOOK_URL = 'https://0.entreshijosprotec.ct.ws/webhook'; // Subdominio correcto
const REDIRECT_BASE_URL = 'https://0.entreshijosprotec.ct.ws/redirect/'; // Subdominio correcto

// Configuración de Supabase
const SUPABASE_URL = 'https://ycvkdxzxrzuwnkybmjwf.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljdmtkeHp4crp1d25reWJtandmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI4Mjg4NzYsImV4cCI6MjA1ODQwNDg3Nn0.1ts8XIpysbMe5heIg3oWLfqKxReusZxemw4lk2WZ4GI';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljdmtkeHp4crp1d25reWJtandmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0MjgyODg3NiwiZXhwIjoyMDU4NDA0ODc2fQ.q1234567890abcdefghij';

// Cliente de Supabase
const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Configuración de grupos y canales específicos
const GRUPOS_PREDEFINIDOS = { 
  '-1002348662107': 'GLOBAL SPORTS STREAM',
  '-1002616995435': 'TEST GROUP'
};
const CANALES_ESPECIFICOS = { 
  '-1002348662107': { chat_id: '-1002348662107', thread_id: '47899' },
  '-1002616995435': { chat_id: '-1002616995435', thread_id: null }
};

// Mapa para almacenar orígenes de mensajes
const messageOrigins = new Map();

// Crear el bot con webhook
const bot = new TelegramBot(TOKEN, { polling: false });

// Crear el servidor Express
const app = express();
app.use(express.json());

// Ruta para UptimeRobot
app.get('/ping', (req, res) => {
  res.status(200).send('Bot is alive!');
});

// Rate limiting para la ruta de redirección
const redirectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 500, // Máximo 500 clics por usuario en 15 minutos
  keyGenerator: (req) => req.query.username || 'unknown',
  message: 'Demasiados clics en poco tiempo. Por favor, intenta de nuevo más tarde.'
});

// Generador de shortId con alfabeto personalizado (asíncrono)
const generateShortId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 10);

// **Migración de la base de datos**
async function migrateDatabase() {
  try {
    console.log('📦 Iniciando migración de la base de datos...');

    // Eliminar la columna token si existe
    await supabaseService.rpc('execute_sql', {
      query: `
        ALTER TABLE IF EXISTS short_links DROP COLUMN IF EXISTS token;
      `
    });

    // Crear tabla short_links sin la columna token
    await supabaseService.rpc('execute_sql', {
      query: `
        CREATE TABLE IF NOT EXISTS short_links (
          id TEXT PRIMARY KEY,
          original_url TEXT NOT NULL,
          message_id BIGINT NOT NULL,
          chat_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_short_links_chat_id ON short_links (chat_id);
        CREATE INDEX IF NOT EXISTS idx_short_links_expires_at ON short_links (expires_at);
      `
    });

    // Crear tabla clicks
    await supabaseService.rpc('execute_sql', {
      query: `
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        CREATE TABLE IF NOT EXISTS clicks (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          short_id TEXT NOT NULL,
          username TEXT NOT NULL,
          original_url TEXT NOT NULL,
          click_count BIGINT NOT NULL DEFAULT 1,
          last_clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT unique_short_id_username UNIQUE (short_id, username)
        );
        CREATE INDEX IF NOT EXISTS idx_clicks_short_id_username ON clicks (short_id, username);
        CREATE INDEX IF NOT EXISTS idx_clicks_last_clicked_at ON clicks (last_clicked_at);
      `
    });

    console.log('✅ Migración de la base de datos completada.');
  } catch (error) {
    console.error('❌ Error durante la migración de la base de datos:', error.message);
    process.exit(1);
  }
}

// **Sanitizar texto**
function sanitizeText(text) {
  if (!text) return '';
  return text.replace(/[<>&'"]/g, char => ({ '<': '<', '>': '>', '&': '&', "'": '\'', '"': '"' }[char] || char)).trim();
}

// **Extraer URLs únicas (evitar duplicados)**
function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = new Set();
  let match;
  while ((match = urlRegex.exec(text)) !== null) {
    urls.add(match[0]);
  }
  return Array.from(urls);
}

// **Acortar múltiples URLs y almacenar en Supabase**
async function shortenUrl(originalUrls, messageId, chatId, userId, username, expiryHours = 24) {
  const shortLinks = await Promise.all(originalUrls.map(async (url) => {
    const id = await generateShortId(); // Ahora es asíncrono
    return {
      id,
      original_url: url,
      message_id: messageId,
      chat_id: chatId,
      user_id: userId,
      username: username,
      expires_at: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString()
    };
  }));

  const { error } = await supabaseService.from('short_links').insert(shortLinks);

  if (error) {
    console.error(`❌ Error al guardar enlaces acortados: ${error.message}`);
    return null;
  }
  console.log(`✅ Enlaces acortados guardados: ${shortLinks.map(link => link.id).join(', ')}`);
  return shortLinks;
}

// **Reemplazar URLs en el texto con enlaces protegidos**
async function disguiseUrls(text, messageId, chatId, userId, username) {
  const urls = extractUrls(text);
  if (!urls.length) return { modifiedText: text, shortLinks: [] };

  const shortLinks = await shortenUrl(urls, messageId, chatId, userId, username);
  if (!shortLinks) return { modifiedText: text, shortLinks: [] };

  let modifiedText = text;
  const shortLinksData = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const shortLink = shortLinks[i];
    const redirectUrl = `${REDIRECT_BASE_URL}${shortLink.id}`;
    modifiedText = modifiedText.replace(url, '🔗 [Enlace protegido]');
    shortLinksData.push({ shortId: shortLink.id, originalUrl: url });
  }

  return { modifiedText, shortLinks: shortLinksData };
}

// **Registrar un clic en la tabla clicks**
async function registerClick(shortId, username, originalUrl) {
  console.log(`📊 Intentando registrar clic: shortId=${shortId}, username=${username}`);
  try {
    const { data: existingClick, error: selectError } = await supabaseService
      .from('clicks')
      .select('id, click_count')
      .eq('short_id', shortId)
      .eq('username', username)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      console.error(`❌ Error al buscar clic existente: ${selectError.message}`);
      throw new Error(`Error al buscar clic existente: ${selectError.message}`);
    }

    if (existingClick) {
      const { error: updateError } = await supabaseService
        .from('clicks')
        .update({
          click_count: existingClick.click_count + 1,
          last_clicked_at: new Date().toISOString()
        })
        .eq('id', existingClick.id);

      if (updateError) {
        console.error(`❌ Error al actualizar clic: ${updateError.message}`);
        throw new Error(`Error al actualizar clic: ${updateError.message}`);
      }
      console.log(`✅ Clic actualizado para ${username} en ${shortId}: ${existingClick.click_count + 1} clics`);
    } else {
      const { error: insertError } = await supabaseService
        .from('clicks')
        .insert({
          short_id: shortId,
          username: username,
          original_url: originalUrl,
          click_count: 1,
          last_clicked_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        });

      if (insertError) {
        console.error(`❌ Error al registrar clic: ${insertError.message}`);
        throw new Error(`Error al registrar clic: ${insertError.message}`);
      }
      console.log(`✅ Clic registrado para ${username} en ${shortId}`);
    }
  } catch (error) {
    console.error(`❌ Error al registrar clic: ${error.message}`);
  }
}

// **Autoeliminar enlaces expirados**
async function autoCleanExpiredLinks() {
  try {
    const now = new Date().toISOString();

    const { data: expiredLinks, error: selectError } = await supabaseService
      .from('short_links')
      .select('id, chat_id, message_id')
      .lt('expires_at', now);

    if (selectError) throw new Error(`Error al obtener enlaces expirados: ${selectError.message}`);
    if (!expiredLinks || expiredLinks.length === 0) {
      console.log('✅ No hay enlaces expirados para eliminar.');
      return;
    }

    for (const link of expiredLinks) {
      const channel = CANALES_ESPECIFICOS[link.chat_id];
      if (channel) {
        try {
          await bot.deleteMessage(link.chat_id, link.message_id);
          console.log(`✅ Mensaje eliminado: ${link.message_id} en ${link.chat_id}`);
        } catch (error) {
          console.warn(`⚠️ No se pudo eliminar mensaje ${link.message_id}: ${error.message}`);
        }
      }
    }

    const idsToDelete = expiredLinks.map(link => link.id);
    const { error: deleteError } = await supabaseService
      .from('short_links')
      .delete()
      .in('id', idsToDelete);

    if (deleteError) throw new Error(`Error al eliminar enlaces expirados: ${deleteError.message}`);

    console.log(`✅ ${idsToDelete.length} enlaces expirados eliminados.`);
  } catch (error) {
    console.error(`❌ Error al autoeliminar enlaces expirados: ${error.message}`);
  }
}

// **Limpiar messageOrigins periódicamente**
function cleanMessageOrigins() {
  const now = Date.now();
  for (const [messageId, origin] of messageOrigins.entries()) {
    // Elimina entradas más antiguas que 24 horas
    if (now - new Date(origin.timestamp || now).getTime() > 24 * 60 * 60 * 1000) {
      messageOrigins.delete(messageId);
    }
  }
  console.log(`🧹 Limpieza de messageOrigins completada. Entradas restantes: ${messageOrigins.size}`);
}

// **Procesar mensajes**
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) {
    console.log(`⚠️ Chat no predefinido: ${chatId}`);
    return;
  }
  if (threadId && threadId !== CANALES_ESPECIFICOS[chatId]?.thread_id) {
    console.log(`⚠️ Thread no permitido: ${threadId} en chat ${chatId}`);
    return;
  }

  const userId = msg.from.id.toString();
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
  const originalMessageId = msg.message_id;
  const channel = CANALES_ESPECIFICOS[chatId];

  const text = sanitizeText(msg.text || msg.caption);
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  if (msg.text && msg.text.startsWith('/')) {
    console.log(`⚠️ Comando detectado: ${msg.text}`);
    return;
  }
  if (!text && !photo && !video && !animation) {
    console.log(`⚠️ Mensaje sin contenido procesable: ${originalMessageId}`);
    return;
  }

  console.log(`📩 Procesando mensaje: ID=${originalMessageId}, chat=${chatId}, user=${username}`);

  const loadingMsg = await bot.sendMessage(channel.chat_id, '⏳ Generando publicación...', { 
    message_thread_id: channel.thread_id || undefined,
    protect_content: true
  });

  try {
    let finalText = text || '';
    let shortLinks = [];

    if (text) {
      const { modifiedText, shortLinks: generatedLinks } = await disguiseUrls(text, loadingMsg.message_id, chatId, userId, username);
      finalText = modifiedText;
      shortLinks = generatedLinks;
    }

    finalText = finalText ? `${finalText}${SIGNATURE}${WARNING_MESSAGE}` : `📅 Evento${SIGNATURE}${WARNING_MESSAGE}`;

    // Crear botones inline para los enlaces
    const replyMarkup = shortLinks.length > 0 ? {
      inline_keyboard: shortLinks.map(link => [{
        text: 'Acceder al enlace',
        url: `${REDIRECT_BASE_URL}${link.shortId}?username=${encodeURIComponent(username)}`
      }])
    } : undefined;

    await bot.deleteMessage(channel.chat_id, loadingMsg.message_id);

    let sentMessage;
    if (photo) {
      sentMessage = await bot.sendPhoto(channel.chat_id, photo, {
        caption: finalText,
        message_thread_id: channel.thread_id || undefined,
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: replyMarkup
      });
    } else if (video) {
      sentMessage = await bot.sendVideo(channel.chat_id, video, {
        caption: finalText,
        message_thread_id: channel.thread_id || undefined,
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: replyMarkup
      });
    } else if (animation) {
      sentMessage = await bot.sendAnimation(channel.chat_id, animation, {
        caption: finalText,
        message_thread_id: channel.thread_id || undefined,
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: replyMarkup
      });
    } else {
      sentMessage = await bot.sendMessage(channel.chat_id, finalText, {
        message_thread_id: channel.thread_id || undefined,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
        reply_markup: replyMarkup
      });
    }

    messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: finalText, timestamp: new Date().toISOString() });
    console.log(`📍 Almacenado origen del mensaje: message_id=${sentMessage.message_id}, chat_id=${chatId}`);

    await bot.deleteMessage(chatId, originalMessageId);
    console.log(`✅ Mensaje original (ID: ${originalMessageId}) eliminado.`);
  } catch (error) {
    console.error(`❌ Error al procesar mensaje: ${error.message}`);
    await bot.deleteMessage(channel.chat_id, loadingMsg.message_id);
    await bot.sendMessage(channel.chat_id, '⚠️ Error al generar publicación.', { 
      message_thread_id: channel.thread_id || undefined, 
      parse_mode: 'HTML',
      protect_content: true
    });
  }
});

// **Detectar y manejar reenvíos**
bot.on('message', async (msg) => {
  if (!msg.forward_from && !msg.forward_from_chat && !msg.forward_from_message_id) return;

  const chatId = msg.chat.id.toString();
  if (!GRUPOS_PREDEFINIDOS[chatId]) {
    console.log(`⚠️ Chat no predefinido para reenvío: ${chatId}`);
    return;
  }

  const forwardedMessageId = msg.forward_from_message_id;
  console.log(`🔍 Detectado reenvío: message_id=${forwardedMessageId}, chat_id=${chatId}`);

  const forwardedByUser = msg.from;
  const username = forwardedByUser.username ? `@${forwardedByUser.username}` : forwardedByUser.first_name;

  const forwardedFrom = msg.forward_from || msg.forward_from_chat;
  const isBotMessage = forwardedFrom && forwardedFrom.id === bot.id;

  if (!messageOrigins.has(forwardedMessageId) && !isBotMessage) {
    console.log(`⚠️ Mensaje reenviado no encontrado en messageOrigins: message_id=${forwardedMessageId}`);
    return;
  }

  const origin = messageOrigins.get(forwardedMessageId) || { chat_id: chatId };
  const originalChatId = origin.chat_id;
  const channel = CANALES_ESPECIFICOS[originalChatId];

  console.log(`🚨 Reenvío detectado: ${username} reenvió un mensaje exclusivo a ${msg.chat.title || msg.chat.id}`);
  await bot.sendMessage(channel.chat_id, `🚨 ${username} reenvió un mensaje exclusivo a ${msg.chat.title || msg.chat.id}!`, { 
    message_thread_id: channel.thread_id || undefined, 
    parse_mode: 'HTML',
    protect_content: true
  });

  try {
    await bot.deleteMessage(msg.chat.id, msg.message_id);
    await bot.sendMessage(msg.chat.id, `🚫 Mensaje eliminado por compartir contenido exclusivo, ${username}.`, { 
      parse_mode: 'HTML',
      protect_content: true
    });
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
    console.log(`✅ Reenvío registrado: ${username} reenvió mensaje ${forwardedMessageId}`);
  }
});

// **Ruta para manejar la redirección de enlaces acortados con página intermedia**
app.get('/redirect/:shortId', redirectLimiter, async (req, res) => {
  const { shortId } = req.params;
  const username = req.query.username || 'unknown';

  console.log(`🔗 Solicitud de redirección: shortId=${shortId}, username=${username}`);

  try {
    const { data: linkData, error } = await supabaseAnon
      .from('short_links')
      .select('original_url, expires_at')
      .eq('id', shortId)
      .single();

    if (error || !linkData) {
      console.error(`❌ Enlace no encontrado: ${shortId}`);
      return res.status(404).send('Enlace no encontrado o expirado.');
    }

    const expiresAt = new Date(linkData.expires_at);
    const now = new Date();
    if (now > expiresAt) {
      console.warn(`⚠️ Enlace expirado: ${shortId}`);
      return res.status(410).send('El enlace ha expirado.');
    }

    // Mostrar página intermedia de confirmación
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirmación - EntresHijos</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #1a1a1a;
            color: #ffffff;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            text-align: center;
          }
          .container {
            background-color: #2a2a2a;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
          }
          h1 {
            font-size: 24px;
            margin-bottom: 20px;
          }
          button {
            background-color: #ffd700;
            color: #1a1a1a;
            border: none;
            padding: 10px 20px;
            font-size: 16px;
            border-radius: 5px;
            cursor: pointer;
            transition: background-color 0.3s;
          }
          button:hover {
            background-color: #e6c200;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>¿Seguro que quieres acceder al enlace de EntresHijos?</h1>
          <form action="/confirm-redirect/${shortId}" method="POST">
            <input type="hidden" name="username" value="${username}">
            <button type="submit">Sí, continuar</button>
          </form>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error(`❌ Error al procesar redirección: ${error.message}`);
    res.status(500).send('Error interno del servidor.');
  }
});

// **Ruta para confirmar la redirección y registrar el clic**
app.post('/confirm-redirect/:shortId', async (req, res) => {
  const { shortId } = req.params;
  const username = req.body.username || 'unknown';

  console.log(`🔗 Confirmando redirección: shortId=${shortId}, username=${username}`);

  try {
    const { data: linkData, error } = await supabaseAnon
      .from('short_links')
      .select('original_url, expires_at')
      .eq('id', shortId)
      .single();

    if (error || !linkData) {
      console.error(`❌ Enlace no encontrado: ${shortId}`);
      return res.status(404).send('Enlace no encontrado o expirado.');
    }

    const expiresAt = new Date(linkData.expires_at);
    const now = new Date();
    if (now > expiresAt) {
      console.warn(`⚠️ Enlace expirado: ${shortId}`);
      return res.status(410).send('El enlace ha expirado.');
    }

    // Registrar el clic
    await registerClick(shortId, username, linkData.original_url);

    // Redirigir al enlace original
    console.log(`✅ Redirigiendo a: ${linkData.original_url}`);
    res.redirect(linkData.original_url);
  } catch (error) {
    console.error(`❌ Error al confirmar redirección: ${error.message}`);
    res.status(500).send('Error interno del servidor.');
  }
});

// **Ruta para manejar el webhook de Telegram**
app.post('/webhook', (req, res) => {
  console.log('📥 Webhook recibido:', JSON.stringify(req.body));
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// **Configurar webhook, limpieza automática y arrancar**
app.listen(PORT, async () => {
  console.log(`✅ Servidor en puerto ${PORT}`);
  try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log(`✅ Webhook configurado: ${WEBHOOK_URL}`);
  } catch (error) {
    console.error(`❌ Error al configurar webhook: ${error.message}`);
  }

  await migrateDatabase();
  await autoCleanExpiredLinks();
  setInterval(autoCleanExpiredLinks, AUTO_CLEAN_INTERVAL);
  setInterval(cleanMessageOrigins, MESSAGE_ORIGINS_CLEAN_INTERVAL);
});