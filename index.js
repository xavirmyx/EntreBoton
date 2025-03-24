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

// Almacenamiento de registros de clics (en memoria, para este ejemplo)
const clickRecords = [];

// Crear el bot con opciones para webhook
const bot = new TelegramBot(TOKEN, { polling: false });

// Crear el servidor Express
const app = express();
app.use(express.json());

// Función para sanitizar texto (eliminar caracteres problemáticos)
function sanitizeText(text) {
  if (!text) return '';
  // Reemplazar caracteres problemáticos y asegurarse de que el texto sea seguro para HTML
  return text
    .replace(/[\r\n]+/g, ' ') // Reemplazar saltos de línea por espacios
    .replace(/[<>&'"]/g, (char) => {
      // Escapar caracteres especiales para HTML
      switch (char) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case "'": return '&apos;'; // Corregir el escape de comillas simples
        case '"': return '&quot;';
        default: return char;
      }
    })
    .trim();
}

// Función para analizar enlaces
async function analyzeLink(url) {
  console.log(`Analizando enlace: ${url}`);
  try {
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 5000, // Reducir el timeout a 5 segundos
      maxRedirects: 5, // Limitar el número de redirecciones
    });
    const $ = cheerio.load(response.data);

    // Extraer título
    let title = $('meta[property="og:title"]').attr('content') || $('title').text() || 'Sin título';
    title = sanitizeText(title);

    // Extraer descripción
    let description = $('meta[property="og:description"]').attr('content') || 'Visita este enlace para más info.';
    description = sanitizeText(description);

    // Extraer imagen (si existe)
    let imageUrl = $('meta[property="og:image"]').attr('content') || null;

    console.log(`Enlace analizado: ${url} - Título: ${title}`);
    return { title, description, imageUrl };
  } catch (error) {
    console.error(`Error al analizar el enlace ${url}: ${error.message}`);
    return { title: 'Enlace', description: 'Visita este enlace', imageUrl: null };
  }
}

// Función para generar botones inline para múltiples enlaces
function createButtons(urls, messageId) {
  const keyboard = [];
  // Añadir un botón para cada enlace con un callback_data único
  urls.forEach((url, index) => {
    keyboard.push([{
      text: `🔗 Enlace ${index + 1}`,
      callback_data: `click_${messageId}_${index}`,
      url: url
    }]);
  });
  return { inline_keyboard: keyboard };
}

// Función para extraer todos los enlaces del texto
function extractUrls(msg) {
  const text = msg.text || msg.caption || '';
  console.log('Texto para extraer URLs:', text);

  // Método 1: Usar expresión regular
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let urls = text.match(urlRegex) || [];
  console.log('URLs extraídas con regex:', urls);

  // Método 2: Usar entidades de Telegram como respaldo
  const entities = msg.entities || msg.caption_entities || [];
  const entityUrls = entities
    .filter(entity => entity.type === 'url')
    .map(entity => text.substr(entity.offset, entity.length));
  console.log('URLs extraídas de entidades:', entityUrls);

  // Combinar URLs de ambos métodos y eliminar duplicados
  urls = [...new Set([...urls, ...entityUrls])];
  console.log(`Enlaces extraídos (total): ${urls.length}`, urls);

  return urls;
}

// Comando /boton
bot.onText(/\/boton(?:\s+(.+))?/, async (msg, match) => {
  console.log('Recibido comando /boton:', JSON.stringify(msg, null, 2));
  const chatId = msg.chat.id;
  const urls = extractUrls(msg); // Extraer todos los enlaces
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;
  const captionText = msg.caption || msg.text || 'Publicación';

  console.log(`URLs encontradas: ${urls.length}, Foto: ${!!photo}, Animación: ${!!animation}`);

  // Si no hay contenido válido, pedir input
  if (!urls.length && !photo && !animation) {
    console.log('No se encontraron URLs, fotos ni animaciones. Enviando mensaje de error.');
    await bot.sendMessage(chatId, '📩 Por favor, envía al menos un enlace, foto o GIF. Ejemplo: /boton https://ejemplo.com https://otro.com');
    return;
  }

  // Enviar mensaje de carga
  console.log('Enviando mensaje de carga...');
  const loadingMsg = await bot.sendMessage(chatId, '⏳ Generando tu publicación...');
  console.log(`Mensaje de carga enviado: ${loadingMsg.message_id}`);

  // Determinar título y descripción
  let titles = [];
  let descriptions = [];
  let imageUrl = null;

  if (urls.length) {
    console.log(`Procesando ${urls.length} enlaces...`);
    // Analizar cada enlace
    for (const url of urls) {
      const { title, description, image } = await analyzeLink(url);
      titles.push(title);
      descriptions.push(description);
      if (image && !imageUrl) imageUrl = image; // Usar la primera imagen encontrada
    }
    console.log('Enlaces procesados:', titles);
  } else {
    titles = [captionText];
    descriptions = ['Contenido multimedia'];
    console.log('No hay enlaces, usando captionText:', captionText);
  }

  // Formatear el mensaje en HTML
  let caption = '📢 ';
  if (urls.length) {
    // Si hay múltiples enlaces, enumerarlos
    titles.forEach((title, index) => {
      caption += `<b>Enlace ${index + 1}: ${title}</b>\n${descriptions[index]}\n`;
    });
  } else {
    // Si no hay enlaces, usar el título y descripción por defecto
    caption += `<b>${titles[0]}</b>\n${descriptions[0]}\n`;
  }
  caption += `\n${SIGNATURE}`;
  console.log('Caption generado:', caption);

  try {
    let sentMessage;
    console.log('Enviando mensaje final...');
    // Caso 1: Solo enlaces (sin multimedia adjunto)
    if (urls.length && !photo && !animation) {
      console.log('Caso 1: Solo enlaces');
      if (imageUrl) {
        sentMessage = await bot.sendPhoto(chatId, imageUrl, {
          caption,
          parse_mode: 'HTML',
          reply_markup: createButtons(urls, loadingMsg.message_id),
        });
      } else {
        sentMessage = await bot.sendMessage(chatId, caption, {
          parse_mode: 'HTML',
          reply_markup: createButtons(urls, loadingMsg.message_id),
        });
      }
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 2: Solo foto (sin enlaces)
    else if (photo && !urls.length && !animation) {
      console.log('Caso 2: Solo foto');
      sentMessage = await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'HTML',
        reply_markup: createButtons(urls, loadingMsg.message_id),
      });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 3: Solo GIF (sin enlaces)
    else if (animation && !urls.length && !photo) {
      console.log('Caso 3: Solo GIF');
      sentMessage = await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'HTML',
        reply_markup: createButtons(urls, loadingMsg.message_id),
      });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 4: Enlaces + Foto
    else if (urls.length && photo && !animation) {
      console.log('Caso 4: Enlaces + Foto');
      sentMessage = await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'HTML',
        reply_markup: createButtons(urls, loadingMsg.message_id),
      });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 5: Enlaces + GIF
    else if (urls.length && animation && !photo) {
      console.log('Caso 5: Enlaces + GIF');
      sentMessage = await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'HTML',
        reply_markup: createButtons(urls, loadingMsg.message_id),
      });
      await bot.deleteMessage(chatId, loadingMsg.message_id);
    }
    // Caso 6: Combinaciones no soportadas
    else {
      console.log('Caso 6: Combinación no soportada');
      await bot.editMessageText('⚠️ Combinación no soportada. Usa enlaces, foto o GIF por separado o con enlaces.', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
      });
      return;
    }

    console.log(`Mensaje enviado: ${sentMessage.message_id}`);
    // Actualizar los botones con el message_id del mensaje enviado
    await bot.editMessageReplyMarkup(createButtons(urls, sentMessage.message_id), {
      chat_id: chatId,
      message_id: sentMessage.message_id,
    });
    console.log('Botones actualizados con el nuevo message_id');

  } catch (error) {
    console.error(`Error al procesar el comando /boton: ${error.message}`);
    await bot.editMessageText('⚠️ Ocurrió un error al generar la publicación.', {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'HTML',
    });
  }
});

// Manejar clics en los botones
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const user = query.from;
  const data = query.data;

  if (data.startsWith('click_')) {
    const [, , linkIndex] = data.split('_');
    const timestamp = new Date().toISOString();

    // Registrar el clic
    clickRecords.push({
      chatId,
      messageId,
      linkIndex: parseInt(linkIndex) + 1,
      user: {
        id: user.id,
        first_name: user.first_name,
        username: user.username,
      },
      timestamp,
    });

    console.log(`Clic registrado: ${JSON.stringify(clickRecords[clickRecords.length - 1])}`);

    // Responder al usuario (opcional, para confirmar el clic)
    await bot.answerCallbackQuery(query.id, { text: `Has pulsado el Enlace ${parseInt(linkIndex) + 1}` });
  }
});

// Comando /visto
bot.onText(/\/visto/, async (msg) => {
  const chatId = msg.chat.id;

  // Filtrar registros para este chat
  const records = clickRecords.filter(record => record.chatId === chatId);

  if (records.length === 0) {
    await bot.sendMessage(chatId, '📊 No hay registros de clics en este chat.');
    return;
  }

  // Formatear los registros
  let response = '<b>📊 Registros de clics:</b>\n\n';
  records.forEach(record => {
    const userName = record.user.username ? `@${record.user.username}` : record.user.first_name;
    response += `<b>Mensaje ID:</b> ${record.messageId}\n`;
    response += `<b>Enlace:</b> ${record.linkIndex}\n`;
    response += `<b>Usuario:</b> ${userName}\n`;
    response += `<b>Hora:</b> ${new Date(record.timestamp).toLocaleString('es-ES')}\n\n`;
  });

  await bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
});

// Configurar el webhook
app.get('/', (req, res) => {
  console.log('Recibida solicitud GET en /');
  res.send('This is a Telegram webhook server. Please use POST requests for updates.');
});

app.post('/webhook', (req, res) => {
  console.log('Recibida solicitud POST en /webhook:', JSON.stringify(req.body, null, 2));
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Iniciar el servidor
app.listen(PORT, async () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
  try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log(`Webhook configurado en ${WEBHOOK_URL}`);
  } catch (error) {
    console.error(`Error al configurar el webhook: ${error.message}`);
  }
});