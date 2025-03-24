const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// Configurar logging
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

// Almacenamiento de registros de interacciones (en memoria, para este ejemplo)
const interactionRecords = [];

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
  return text
    .replace(/[\r\n]+/g, '\n') // Mantener saltos de línea
    .replace(/[<>&'"]/g, (char) => {
      switch (char) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case "'": return '&apos;';
        case '"': return '&quot;';
        default: return char;
      }
    })
    .trim();
}

// Función para extraer todos los enlaces del texto
function extractUrls(msg) {
  const text = msg.text || msg.caption || '';
  console.log('📝 Texto para extraer URLs:', text);

  // Método 1: Usar expresión regular
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let urls = text.match(urlRegex) || [];
  console.log('🔗 URLs extraídas con regex:', urls);

  // Método 2: Usar entidades de Telegram como respaldo
  const entities = msg.entities || msg.caption_entities || [];
  const entityUrls = entities
    .filter(entity => entity.type === 'url')
    .map(entity => text.substr(entity.offset, entity.length));
  console.log('🔗 URLs extraídas de entidades:', entityUrls);

  // Combinar URLs de ambos métodos y eliminar duplicados
  urls = [...new Set([...urls, ...entityUrls])];
  console.log(`🔗 Enlaces extraídos (total): ${urls.length}`, urls);

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
      // Reemplazar el enlace con un enlace clickable
      line = line.replace(urlInLine, `<a href="${urlInLine}">🔗 Enlace ${urlIndex + 1}</a>`);
      urlIndex++;
    }
    formattedText += line + '\n';
  }

  return { formattedText: formattedText.trim(), urlPositions };
}

// Procesar todos los mensajes automáticamente
bot.on('message', async (msg) => {
  console.log('📩 Mensaje recibido:', JSON.stringify(msg, null, 2));
  const chatId = msg.chat.id;
  const text = msg.text || msg.caption || '';
  const urls = extractUrls(msg); // Extraer todos los enlaces
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  console.log(`🔗 URLs encontradas: ${urls.length}, 📷 Foto: ${!!photo}, 🎥 Video: ${!!video}, 🎞️ Animación: ${!!animation}`);

  // Ignorar mensajes que sean comandos (excepto /visto, que se maneja por separado)
  if (msg.text && msg.text.startsWith('/')) {
    return; // Saltar comandos
  }

  // Si no hay contenido válido, ignorar el mensaje
  if (!urls.length && !photo && !video && !animation) {
    console.log('❌ No se encontraron URLs, fotos, videos ni animaciones. Ignorando mensaje.');
    return;
  }

  // Enviar mensaje de carga
  console.log('⏳ Enviando mensaje de carga...');
  let loadingMsg;
  try {
    loadingMsg = await bot.sendMessage(chatId, '⏳ Generando tu publicación...');
    console.log(`✅ Mensaje de carga enviado: ${loadingMsg.message_id}`);
  } catch (error) {
    console.error(`❌ Error al enviar mensaje de carga: ${error.message}`);
    return;
  }

  // Estructurar el mensaje
  const { formattedText } = structureMessage(text, urls);
  let caption = formattedText;
  if (!caption) {
    caption = '📢 Publicación\n';
    urls.forEach((url, index) => {
      caption += `<a href="${url}">🔗 Enlace ${index + 1}</a>\n`;
    });
  }
  caption += `${SIGNATURE}${WARNING_MESSAGE}`; // Añadir la firma y la advertencia
  console.log('📝 Caption generado:', caption);

  try {
    console.log('📤 Enviando mensaje final...');
    let sentMessage;
    // Caso 1: Solo enlaces (sin multimedia adjunto)
    if (urls.length && !photo && !video && !animation) {
      console.log('📜 Caso 1: Solo enlaces');
      sentMessage = await bot.editMessageText(caption, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true, // Desactivar el reenvío (requiere permisos de administrador)
      });
    }
    // Caso 2: Solo foto (sin enlaces)
    else if (photo && !urls.length && !video && !animation) {
      console.log('📷 Caso 2: Solo foto');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    }
    // Caso 3: Solo video (sin enlaces)
    else if (video && !urls.length && !photo && !animation) {
      console.log('🎥 Caso 3: Solo video');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendVideo(chatId, video, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    }
    // Caso 4: Solo GIF (sin enlaces)
    else if (animation && !urls.length && !photo && !video) {
      console.log('🎞️ Caso 4: Solo GIF');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    }
    // Caso 5: Enlaces + Foto
    else if (urls.length && photo && !video && !animation) {
      console.log('📷🔗 Caso 5: Enlaces + Foto');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    }
    // Caso 6: Enlaces + Video
    else if (urls.length && video && !photo && !animation) {
      console.log('🎥🔗 Caso 6: Enlaces + Video');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendVideo(chatId, video, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    }
    // Caso 7: Enlaces + GIF
    else if (urls.length && animation && !photo && !video) {
      console.log('🎞️🔗 Caso 7: Enlaces + GIF');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    }
    // Caso 8: Combinaciones no soportadas
    else {
      console.log('❌ Caso 8: Combinación no soportada');
      await bot.editMessageText('⚠️ Combinación no soportada. Usa enlaces con solo un tipo de multimedia (foto, video o GIF).', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
      });
      return;
    }

    // Guardar el origen del mensaje
    messageOrigins.set(sentMessage.message_id, { chat_id: chatId, message_text: caption });
    console.log(`✅ Mensaje enviado y registrado: ${sentMessage.message_id}`);

  } catch (error) {
    console.error(`❌ Error al procesar el mensaje: ${error.message}`);
    await bot.editMessageText('⚠️ Ocurrió un error al generar la publicación.', {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: 'HTML',
    });
  }
});

// Detectar reenvíos de mensajes y proteger contra robo de contenido
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
      const warningText = `🚨 !${userName} ha reenviado el mensaje!\n\n` +
                        `📜 Mensaje reenviado:\n${originalMessageText.slice(0, 100)}...\n` +
                        `📍 Reenviado a: ${msg.chat.title || msg.chat.id} (ID: ${msg.chat.id})`;

      try {
        await bot.sendMessage(originalChatId, warningText, { parse_mode: 'HTML' });
        console.log(`✅ Advertencia de reenvío enviada al grupo original (${originalChatId})`);
      } catch (error) {
        console.error(`❌ Error al enviar advertencia de reenvío al grupo original: ${error.message}`);
      }

      // Enviar mensaje al usuario que reenvió (en el chat destino)
      try {
        await bot.sendMessage(msg.chat.id, `🚨 Este mensaje es exclusivo para el grupo original. Por favor, no lo compartas.`, {
          parse_mode: 'HTML',
        });
        console.log(`✅ Advertencia enviada al usuario que reenvió (${forwardedByUser.id}) en el chat destino (${msg.chat.id})`);
      } catch (error) {
        console.error(`❌ Error al enviar advertencia al usuario que reenvió: ${error.message}`);
      }

      // Intentar eliminar el mensaje reenviado del chat destino (si el bot tiene permisos)
      try {
        await bot.deleteMessage(msg.chat.id, msg.message_id);
        console.log(`✅ Mensaje reenviado eliminado del chat destino (${msg.chat.id})`);
      } catch (error) {
        console.error(`❌ Error al eliminar el mensaje reenviado del chat destino: ${error.message}`);
      }

      // Registrar la interacción
      interactionRecords.push({
        type: 'forward',
        chatId: originalChatId,
        messageId: forwardedMessageId,
        user: {
          id: forwardedByUser.id,
          first_name: forwardedByUser.first_name,
          username: forwardedByUser.username,
        },
        timestamp: new Date().toISOString(),
      });
    }
  }
});

// Comando /visto
bot.onText(/\/visto/, async (msg) => {
  const chatId = msg.chat.id;

  // Filtrar registros para este chat
  const records = interactionRecords.filter(record => record.chatId === chatId);

  if (records.length === 0) {
    await bot.sendMessage(chatId, '📊 No hay registros de interacciones en este chat. 🕵️‍♂️');
    return;
  }

  // Formatear los registros
  let response = '<b>📊 Registros de interacciones:</b>\n\n';
  records.forEach(record => {
    const userName = record.user.username ? `@${record.user.username}` : record.user.first_name;
    response += `<b>📜 Mensaje ID:</b> ${record.messageId}\n`;
    response += `<b>🚨 Acción:</b> ${record.type === 'forward' ? 'Reenvió el mensaje' : 'Interactuó con el mensaje'}\n`;
    response += `<b>👤 Usuario:</b> ${userName}\n`;
    response += `<b>⏰ Hora:</b> ${new Date(record.timestamp).toLocaleString('es-ES')}\n\n`;
  });

  await bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
});

// Configurar el webhook
app.get('/', (req, res) => {
  console.log('📥 Recibida solicitud GET en /');
  res.send('This is a Telegram webhook server for EntresHijos. Please use POST requests for updates. 🚀');
});

app.post('/webhook', (req, res) => {
  console.log('📥 Recibida solicitud POST en /webhook:', JSON.stringify(req.body, null, 2));
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Iniciar el servidor
app.listen(PORT, async () => {
  console.log(`✅ Servidor iniciado en el puerto ${PORT}`);
  try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log(`✅ Webhook configurado en ${WEBHOOK_URL}`);
  } catch (error) {
    console.error(`❌ Error al configurar el webhook: ${error.message}`);
  }
});