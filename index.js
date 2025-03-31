const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { customAlphabet } = require('nanoid/non-secure'); // Usamos nanoid/non-secure (síncrono) de la versión 4
const { createCanvas } = require('canvas');
const rateLimit = require('express-rate-limit');

// Configuración de logging
console.log('🚀 Iniciando el bot EntresHijos...');

// Token del bot
const TOKEN = '7624808452:AAHffFqqhaXtun4XthusBfeeeVDcp6Qsrs4';

// Firma con emojis (permanente en todos los mensajes)
const SIGNATURE = '\n\n✨ EntresHijos ✨';

// Advertencia para no compartir ni hacer capturas
const WARNING_MESSAGE = '\n⚠️ Este mensaje es exclusivo para este grupo. No lo copies, reenvíes ni hagas capturas de pantalla para proteger el contenido.';

// Intervalo para limpieza automática (en milisegundos, ej. cada 6 horas)
const AUTO_CLEAN_INTERVAL = 6 * 60 * 60 * 1000; // 6 horas

// Configuración del servidor webhook
const PORT = process.env.PORT || 8443;
const WEBHOOK_URL = 'https://entreboton.onrender.com/webhook';
const REDIRECT_BASE_URL = 'https://ehjs.link/redirect/'; // Dominio ficticio para los enlaces disfrazados

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

// Rate limiting para la ruta de redirección
const redirectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // Máximo 100 clics por usuario en 15 minutos
  keyGenerator: (req) => req.query.username || 'unknown',
  message: 'Demasiados clics en poco tiempo. Por favor, intenta de nuevo más tarde.'
});

// Generador de shortId con alfabeto personalizado (síncrono)
const generateShortId = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 10);

// **Generar una imagen con el enlace**
function generateLinkImage(linkText) {
  const width = 600;
  const height = 100;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fondo oscuro
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, width, height);

  // Texto del enlace
  ctx.font = '20px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(linkText, width / 2, height / 2 - 10);

  // Marca EntresHijos
  ctx.font = '14px Arial';
  ctx.fillStyle = '#ffd700';
  ctx.fillText('✨ EntresHijos ✨', width / 2, height / 2 + 20);

  return canvas.toBuffer('image/png');
}

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

// **Acortar URL y almacenar en Supabase**
async function shortenUrl(originalUrl, messageId, chatId, userId, username, expiryHours = 24) {
  const shortId = generateShortId(); // Ahora es síncrono
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseService.from('short_links').insert({
    id: shortId,
    original_url: originalUrl,
    message_id: messageId,
    chat_id: chatId,
    user_id: userId,
    username: username,
    expires_at: expiresAt
  });

  if (error) {
    console.error(`❌ Error al guardar enlace acortado: ${error.message}`);
    return null;
  }
  console.log(`✅ Enlace acortado guardado: ${shortId}`);
  return shortId;
}

// **Reemplazar URLs en el texto y generar imágenes**
async function disguiseUrls(text, messageId, chatId, userId, username) {
  const urls = extractUrls(text);
  if (!urls.length) return { modifiedText: text, shortLinks: [], linkImages: [] };

  const shortLinks = [];
  const linkImages = [];
  let modifiedText = text;

  for (const url of urls) {
    const shortId = await shortenUrl(url, messageId, chatId, userId, username);
    if (shortId) {
      const redirectUrl = `${REDIRECT_BASE_URL}${shortId}`;
      modifiedText = modifiedText.replace(url, '[ENLACE PROTEGIDO]');
      shortLinks.push({ shortId, originalUrl: url });
      const imageBuffer = generateLinkImage(redirectUrl);
      linkImages.push(imageBuffer);
    }
  }

  return { modifiedText, shortLinks, linkImages };
}

// **Registrar un clic en la tabla clicks**
async function registerClick(shortId, username, originalUrl) {
  try {
    const { data: existingClick, error: selectError } = await supabaseService
      .from('clicks')
      .select('id, click_count')
      .eq('short_id', shortId)
      .eq('username', username)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
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

      if (updateError) throw new Error(`Error al actualizar clic: ${updateError.message}`);
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

      if (insertError) throw new Error(`Error al registrar clic: ${insertError.message}`);
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

// **Procesar mensajes**
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const threadId = msg.message_thread_id ? msg.message_thread_id.toString() : null;

  if (!GRUPOS_PREDEFINIDOS[chatId]) return;
  if (threadId && threadId !== CANALES_ESPECIFICOS[chatId]?.thread_id) return;

  const userId = msg.from.id.toString();
  const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
  const originalMessageId = msg.message_id;
  const channel = CANALES_ESPECIFICOS[chatId];

  const text = sanitizeText(msg.text || msg.caption);
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  if (msg.text && msg.text.startsWith('/')) return;
  if (!text && !photo && !video && !animation) return;

  const loadingMsg = await bot.sendMessage(channel.chat_id, '⏳ Generando publicación...', { 
    message_thread_id: channel.thread_id || undefined,
    protect_content: true
  });

  try {
    let finalText = text || '';
    let shortLinks = [];
    let linkImages = [];

    if (text) {
      const { modifiedText, shortLinks: generatedLinks, linkImages: generatedImages } = await disguiseUrls(text, loadingMsg.message_id, chatId, userId, username);
      finalText = modifiedText;
      shortLinks = generatedLinks;
      linkImages = generatedImages;
    }

    finalText = finalText ? `${finalText}${SIGNATURE}${WARNING_MESSAGE}` : `📅 Evento${SIGNATURE}${WARNING_MESSAGE}`;

    await bot.deleteMessage(channel.chat_id, loadingMsg.message_id);

    let sentMessage;
    if (photo) {
      sentMessage = await bot.sendPhoto(channel.chat_id, photo, {
        caption: finalText,
        message_thread_id: channel.thread_id || undefined,
        parse_mode: 'HTML',
        protect_content: true
      });
    } else if (video) {
      sentMessage = await bot.sendVideo(channel.chat_id, video, {
        caption: finalText,
        message_thread_id: channel.thread_id || undefined,
        parse_mode: 'HTML',
        protect_content: true
      });
    } else if (animation) {
      sentMessage = await bot.sendAnimation(channel.chat_id, animation, {
        caption: finalText,
        message_thread_id: channel.thread_id || undefined,
        parse_mode: 'HTML',
        protect_content: true
      });
    } else {
      sentMessage = await bot.sendMessage(channel.chat_id, finalText, {
        message_thread_id: channel.thread_id || undefined,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true
      });
    }

    // Enviar las imágenes de los enlaces
    for (const imageBuffer of linkImages) {
      await bot.sendPhoto(channel.chat_id, imageBuffer, {
        caption: '🔗 Enlace protegido - Haz clic en la imagen para acceder',
        message_thread_id: channel.thread_id || undefined,
        protect_content: true
      });
    }

    messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: finalText });

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

// **Ruta para manejar la redirección de enlaces acortados**
app.get('/redirect/:shortId', redirectLimiter, async (req, res) => {
  const { shortId } = req.params;
  const username = req.query.username || 'unknown';

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

    await registerClick(shortId, username, linkData.original_url);

    console.log(`✅ Redirigiendo a: ${linkData.original_url}`);
    res.redirect(linkData.original_url);
  } catch (error) {
    console.error(`❌ Error al procesar redirección: ${error.message}`);
    res.status(500).send('Error interno del servidor.');
  }
});

// **Ruta para manejar el webhook de Telegram**
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// **Configurar webhook, limpieza automática y arrancar**
app.listen(PORT, async () => {
  console.log(`✅ Servidor en puerto ${PORT}`);
  await bot.setWebHook(WEBHOOK_URL);

  await migrateDatabase();
  await autoCleanExpiredLinks();
  setInterval(autoCleanExpiredLinks, AUTO_CLEAN_INTERVAL);
});