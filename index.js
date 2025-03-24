const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// Configurar logging
console.log('Iniciando el bot...');

// Token del bot
const TOKEN = '7624808452:AAHffFqqhaXtun4XthusBfeeeVDcp6Qsrs4';

// Firma con emojis
const SIGNATURE = '✨ EntresHijos ✨';

// Advertencia para no compartir
const WARNING_MESSAGE = '\n\n⚠️ Este mensaje es exclusivo para este grupo. Por favor, no lo compartas.';

// Configuración del servidor webhook
const PORT = process.env.PORT || 8443;
const WEBHOOK_URL = 'https://entreboton.onrender.com/webhook';

// Almacenamiento de registros de clics (en memoria, para este ejemplo)
const clickRecords = [];

// Almacenamiento de los chat_id originales de los mensajes (para verificar si se reenvían)
const messageOrigins = new Map(); // Mapa para almacenar message_id -> { chat_id, message_text }

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
    .replace(/[\r\n]+/g, '\n') // Mantener saltos de línea
    .replace(/[<>&'"]/g, (char) => {
      // Escapar caracteres especiales para HTML
      switch (char) {
        case '<': return '<';
        case '>': return '>';
        case '&': return '&';
        case "'": return "'";
        case '"': return '"';
        default: return char;
      }
    })
    .trim();
}

// Función para generar botones inline para múltiples enlaces
function createButtons(urls, messageId, originalChatId) {
  const keyboard = [];
  // Añadir un botón para cada enlace con un callback_data único
  urls.forEach((url, index) => {
    keyboard.push([{
      text: `🔗 Enlace ${index + 1}`,
      callback_data: `click_${messageId}_${index}_${originalChatId}`, // Añadimos el chat_id original al callback_data
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

// Función para estructurar el mensaje con los enlaces
function structureMessage(text, urls) {
  if (!text) return { formattedText: '', urlPositions: [] };

  const lines = text.split('\n');
  let formattedText = '';
  let urlPositions = [];
  let urlIndex = 0;

  for (let line of lines) {
    // Buscar si la línea contiene un enlace
    const urlInLine = urls.find(url => line.includes(url));
    if (urlInLine) {
      // Guardar la posición del enlace
      urlPositions.push({ url: urlInLine, lineIndex: lines.indexOf(line) });
      // Reemplazar el enlace con el texto del botón
      line = line.replace(urlInLine, `(enlace ${urlIndex + 1})`);
      urlIndex++;
    }
    formattedText += line + '\n';
  }

  // Eliminar el comando /boton del texto
  formattedText = formattedText.replace(/\/boton\s*/, '');

  return { formattedText: formattedText.trim(), urlPositions };
}

// Detectar reenvíos de mensajes
bot.on('message', async (msg) => {
  // Verificar si el mensaje es un reenvío
  if (msg.forward_from || msg.forward_from_chat || msg.forward_from_message_id) {
    const forwardedMessageId = msg.forward_from_message_id;
    const forwardedFromChatId = msg.forward_from_chat ? msg.forward_from_chat.id : null;
    const forwardedByUser = msg.from;

    // Verificar si el mensaje reenviado es uno de los mensajes del bot
    if (messageOrigins.has(forwardedMessageId)) {
      const origin = messageOrigins.get(forwardedMessageId);
      const originalChatId = origin.chat_id;
      const originalMessageText = origin.message_text;

      // Enviar advertencia al grupo original
      const userName = forwardedByUser.username ? `@${forwardedByUser.username}` : forwardedByUser.first_name;
      let warningText = `<b>⚠️ Advertencia de reenvío</b>\n\n`;
      warningText += `El usuario ${userName} (ID: ${forwardedByUser.id}) ha reenviado un mensaje del bot.\n`;
      warningText += `Mensaje reenviado:\n${originalMessageText.slice(0, 100)}...\n\n`;
      if (forwardedFromChatId) {
        warningText += `Reenviado al chat: ${msg.chat.title || msg.chat.id} (ID: ${msg.chat.id})\n`;
      } else {
        warningText += `Reenviado a un chat privado (ID: ${msg.chat.id})\n`;
      }
      warningText += `Por favor, recuerda que los enlaces son exclusivos para este grupo.`;

      try {
        await bot.sendMessage(originalChatId, warningText, { parse_mode: 'HTML' });
        console.log(`Advertencia de reenvío enviada al grupo original (${originalChatId})`);
      } catch (error) {
        console.error(`Error al enviar advertencia de reenvío al grupo original: ${error.message}`);
      }

      // Enviar mensaje al usuario que reenvió (en el chat destino)
      try {
        await bot.sendMessage(msg.chat.id, `⚠️ Este mensaje es exclusivo para el grupo original. Por favor, no lo compartas.`, {
          parse_mode: 'HTML',
        });
        console.log(`Advertencia enviada al usuario que reenvió (${forwardedByUser.id}) en el chat destino (${msg.chat.id})`);
      } catch (error) {
        console.error(`Error al enviar advertencia al usuario que reenvió: ${error.message}`);
      }
    }
  }
});

// Comando /boton
bot.onText(/\/boton(?:\s+(.+))?/, async (msg, match) => {
  console.log('Recibido comando /boton:', JSON.stringify(msg, null, 2));
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption || '';
  const urls = extractUrls(msg); // Extraer todos los enlaces
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  console.log(`URLs encontradas: ${urls.length}, Foto: ${!!photo}, Video: ${!!video}, Animación: ${!!animation}`);

  // Si no hay contenido válido, pedir input
  if (!urls.length && !photo && !video && !animation) {
    console.log('No se encontraron URLs, fotos, videos ni animaciones. Enviando mensaje de error.');
    await bot.sendMessage(chatId, '📩 Por favor, envía al menos un enlace, foto, video o GIF. Ejemplo: /boton https://ejemplo.com');
    return;
  }

  // Enviar mensaje de carga
  console.log('Enviando mensaje de carga...');
  const loadingMsg = await bot.sendMessage(chatId, '⏳ Generando tu publicación...');
  console.log(`Mensaje de carga enviado: ${loadingMsg.message_id}`);

  // Estructurar el mensaje
  const { formattedText } = structureMessage(text, urls);
  let caption = formattedText;
  if (!caption) {
    caption = '📢 Publicación\n';
    urls.forEach((url, index) => {
      caption += `Enlace ${index + 1}: Visita este enlace\n(enlace ${index + 1})\n`;
    });
  }
  caption += `\n${SIGNATURE}${WARNING_MESSAGE}`; // Añadir la firma y la advertencia
  console.log('Caption generado:', caption);

  try {
    console.log('Enviando mensaje final...');
    // Caso 1: Solo enlaces (sin multimedia adjunto)
    if (urls.length && !photo && !video && !animation) {
      console.log('Caso 1: Solo enlaces');
      await bot.editMessageText(caption, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
        disable_web_page_preview: true, // Desactivar previsualización de enlaces
        protect_content: true, // Desactivar el reenvío (requiere permisos de administrador)
        reply_markup: createButtons(urls, loadingMsg.message_id, chatId), // Pasar el chatId original
      });
      // Guardar el origen del mensaje
      messageOrigins.set(loadingMsg.message_id, { chat_id: chatId, message_text: caption });
    }
    // Caso 2: Solo foto (sin enlaces)
    else if (photo && !urls.length && !video && !animation) {
      console.log('Caso 2: Solo foto');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      const sentMessage = await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true, // Desactivar el reenvío
        reply_markup: createButtons(urls, loadingMsg.message_id, chatId),
      });
      messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
    }
    // Caso 3: Solo video (sin enlaces)
    else if (video && !urls.length && !photo && !animation) {
      console.log('Caso 3: Solo video');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      const sentMessage = await bot.sendVideo(chatId, video, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true, // Desactivar el reenvío
        reply_markup: createButtons(urls, loadingMsg.message_id, chatId),
      });
      messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
    }
    // Caso 4: Solo GIF (sin enlaces)
    else if (animation && !urls.length && !photo && !video) {
      console.log('Caso 4: Solo GIF');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      const sentMessage = await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true, // Desactivar el reenvío
        reply_markup: createButtons(urls, loadingMsg.message_id, chatId),
      });
      messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
    }
    // Caso 5: Enlaces + Foto
    else if (urls.length && photo && !video && !animation) {
      console.log('Caso 5: Enlaces + Foto');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      const sentMessage = await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true, // Desactivar el reenvío
        reply_markup: createButtons(urls, loadingMsg.message_id, chatId),
      });
      messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
    }
    // Caso 6: Enlaces + Video
    else if (urls.length && video && !photo && !animation) {
      console.log('Caso 6: Enlaces + Video');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      const sentMessage = await bot.sendVideo(chatId, video, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true, // Desactivar el reenvío
        reply_markup: createButtons(urls, loadingMsg.message_id, chatId),
      });
      messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
    }
    // Caso 7: Enlaces + GIF
    else if (urls.length && animation && !photo && !video) {
      console.log('Caso 7: Enlaces + GIF');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      const sentMessage = await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true, // Desactivar el reenvío
        reply_markup: createButtons(urls, loadingMsg.message_id, chatId),
      });
      messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
    }
    // Caso 8: Combinaciones no soportadas
    else {
      console.log('Caso 8: Combinación no soportada');
      await bot.editMessageText('⚠️ Combinación no soportada. Usa enlaces con solo un tipo de multimedia (foto, video o GIF).', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
      });
      return;
    }

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
    const [, , linkIndex, originalChatId] = data.split('_');
    const timestamp = new Date().toISOString();

    // Verificar si el mensaje está en el chat original
    if (String(chatId) !== String(originalChatId)) {
      await bot.answerCallbackQuery(query.id, { text: '⚠️ Los enlaces solo están disponibles en el grupo original.' });
      return;
    }

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