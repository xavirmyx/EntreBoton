const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

// Configurar logging
console.log('Iniciando el bot...');

// Token del bot
const TOKEN = '7624808452:AAHffFqqhaXtun4XthusBfeeeVDcp6Qsrs4';

// Firma con emojis
const SIGNATURE = '✨ EntresHijos ✨';

// Configuración del servidor webhook
const PORT = process.env.PORT || 8443;
const WEBHOOK_URL = 'https://entreboton.onrender.com/webhook';

// Crear el bot con opciones para webhook
const bot = new TelegramBot(TOKEN, { polling: false });

// Crear el servidor Express
const app = express();
app.use(express.json());

// Función para analizar enlaces
async function analyzeLink(url) {
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    const $ = cheerio.load(response.data);

    // Extraer título
    let title = $('meta[property="og:title"]').attr('content') || $('title').text() || 'Sin título';

    // Extraer descripción
    let description = $('meta[property="og:description"]').attr('content') || 'Visita este enlace para más info.';

    // Extraer imagen (si existe)
    let imageUrl = $('meta[property="og:image"]').attr('content') || null;

    return { title, description, imageUrl };
  } catch (error) {
    console.error(`Error al analizar el enlace ${url}: ${error.message}`);
    return { title: 'Enlace', description: 'Visita este enlace', imageUrl: null };
  }
}

// Función para generar botones inline
function createButtons(url = null) {
  const keyboard = [];
  if (url) {
    keyboard.push([{ text: '🔗 Abrir enlace', url }]);
  }
  keyboard.push([{ text: '📲 Compartir', switch_inline_query: '' }]);
  return { inline_keyboard: keyboard };
}

// Comando /boton
bot.onText(/\/boton(?:\s+(.+))?/, async (msg, match) => {
  console.log('Recibido comando /boton:', msg);
  const chatId = msg.chat.id;
  const url = match[1] || null;
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;
  const captionText = msg.caption || 'Publicación';

  // Si no hay contenido válido, pedir input
  if (!url && !photo && !animation) {
    await bot.sendMessage(chatId, '📩 Por favor, envía un enlace, foto o GIF. Ejemplo: /boton https://ejemplo.com');
    return;
  }

  // Enviar mensaje de carga
  const loadingMsg = await bot.sendMessage(chatId, '⏳ Generando tu publicación...');

  // Determinar título y descripción
  let title, description, imageUrl;
  if (url) {
    ({ title, description, imageUrl } = await analyzeLink(url));
  } else {
    title = captionText;
    description = 'Contenido multimedia';
    imageUrl = null;
  }

  // Formatear el mensaje
  const caption = `📢 *${title}*\n${description}\n\n${SIGNATURE}`;
  const replyMarkup = createButtons(url);

  try {
    // Caso 1: Solo enlace (sin multimedia adjunto)
    if (url && !photo && !animation) {
      if (imageUrl) {
        await bot.sendPhoto(chatId, imageUrl, {
          caption,
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        });
      } else {
        await bot.sendMessage(chatId, caption, {
          parse_mode: 'Markdown',
          reply_markup: replyMarkup,
        });
      }
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 2: Solo foto (sin enlace)
    else if (photo && !url && !animation) {
      await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 3: Solo GIF (sin enlace)
    else if (animation && !url && !photo) {
      await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 4: Enlace + Foto
    else if (url && photo && !animation) {
      await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 5: Enlace + GIF
    else if (url && animation && !photo) {
      await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'Markdown',
        reply_markup: replyMarkup,
      });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 6: Combinaciones no soportadas
    else {
      await bot.editMessageText('⚠️ Combinación no soportada. Usa enlace, foto o GIF por separado o con enlace.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown',
      });
    }
  } catch (error) {
    console.error(`Error al procesar el comando /boton: ${error.message}`);
    await bot.editMessageText('⚠️ Ocurrió un error al generar la publicación.', {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'Markdown',
    });
  }
});

// Configurar el webhook
app.get('/', (req, res) => {
  console.log('Recibida solicitud GET en /');
  res.send('This is a Telegram webhook server. Please use POST requests for updates.');
});

app.post('/webhook', (req, res) => {
  console.log('Recibida solicitud POST en /webhook:', req.body);
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Iniciar el servidor
app.listen(PORT, async () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
  try {
    await bot.setWebHook(WEBHOOK_URL); // Usar setWebHook en lugar de setWebhook
    console.log(`Webhook configurado en ${WEBHOOK_URL}`);
  } catch (error) {
    console.error(`Error al configurar el webhook: ${error.message}`);
  }
});