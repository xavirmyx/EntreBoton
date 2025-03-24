const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const shortid = require('shortid'); // Para generar IDs cortos para los enlaces

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
const REDIRECT_BASE_URL = 'https://entreboton.onrender.com/redirect/'; // URL base para los enlaces acortados

// Almacenamiento de los chat_id originales de los mensajes (para verificar si se reenvían)
const messageOrigins = new Map(); // Mapa para almacenar message_id -> { chat_id, message_text }

// Mapa para almacenar los enlaces acortados (en memoria, para este ejemplo)
const shortLinks = new Map(); // Mapa para almacenar short_id -> { original_url, message_id, chat_id }

// Conectar a la base de datos SQLite
const db = new sqlite3.Database('interactions.db', (err) => {
  if (err) {
    console.error('❌ Error al conectar a la base de datos:', err.message);
  } else {
    console.log('✅ Conectado a la base de datos SQLite');
  }
});

// Crear la tabla de interacciones si no existe
db.run(`
  CREATE TABLE IF NOT EXISTS interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT,
    timestamp TEXT NOT NULL,
    details TEXT
  )
`, (err) => {
  if (err) {
    console.error('❌ Error al crear la tabla interactions:', err.message);
  } else {
    console.log('✅ Tabla interactions creada o ya existe');
  }
});

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
        case '<': return '<';
        case '>': return '>';
        case '&': return '&';
        case "'": return ''';
        case '"': return '"';
        default: return char;
      }
    })
    .trim();
}

// Función para extraer todos los enlaces del texto
function extractUrls(msg) {
  const text = msg.text || msg.caption || '';
  console.log('📝 Texto para extraer URLs:', text);

  const urlRegex = /(https?:\/\/[^\s]+)/g;
  let urls = text.match(urlRegex) || [];
  const entities = msg.entities || msg.caption_entities || [];
  const entityUrls = entities
    .filter(entity => entity.type === 'url')
    .map(entity => text.substr(entity.offset, entity.length));
  urls = [...new Set([...urls, ...entityUrls])];
  console.log(`🔗 Enlaces extraídos (total): ${urls.length}`, urls);

  return urls;
}

// Función para acortar un enlace y almacenarlo
function shortenUrl(originalUrl, messageId, chatId) {
  const shortId = shortid.generate();
  const shortUrl = `${REDIRECT_BASE_URL}${shortId}`;
  shortLinks.set(shortId, { original_url: originalUrl, message_id: messageId, chat_id: chatId });
  return shortUrl;
}

// Función para estructurar el mensaje con los enlaces acortados
function structureMessage(text, urls, messageId, chatId) {
  if (!text) return { formattedText: '', urlPositions: [] };

  const lines = text.split('\n');
  let formattedText = '';
  let urlPositions = [];
  let urlIndex = 0;

  for (let line of lines) {
    const urlInLine = urls.find(url => line.includes(url));
    if (urlInLine) {
      urlPositions.push({ url: urlInLine, lineIndex: lines.indexOf(line) });
      const shortUrl = shortenUrl(urlInLine, messageId, chatId);
      line = line.replace(urlInLine, `<a href="${shortUrl}">🔗 Enlace ${urlIndex + 1}</a>`);
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
  const urls = extractUrls(msg);
  const photo = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
  const video = msg.video ? msg.video.file_id : null;
  const animation = msg.animation ? msg.animation.file_id : null;

  console.log(`🔗 URLs encontradas: ${urls.length}, 📷 Foto: ${!!photo}, 🎥 Video: ${!!video}, 🎞️ Animación: ${!!animation}`);

  if (msg.text && msg.text.startsWith('/')) {
    return; // Saltar comandos
  }

  if (!urls.length && !photo && !video && !animation) {
    console.log('❌ No se encontraron URLs, fotos, videos ni animaciones. Ignorando mensaje.');
    return;
  }

  console.log('⏳ Enviando mensaje de carga...');
  let loadingMsg;
  try {
    loadingMsg = await bot.sendMessage(chatId, '⏳ Generando tu publicación...');
    console.log(`✅ Mensaje de carga enviado: ${loadingMsg.message_id}`);
  } catch (error) {
    console.error(`❌ Error al enviar mensaje de carga: ${error.message}`);
    return;
  }

  const { formattedText } = structureMessage(text, urls, loadingMsg.message_id, chatId);
  let caption = formattedText;
  if (!caption) {
    caption = '📢 Publicación\n';
    urls.forEach((url, index) => {
      const shortUrl = shortenUrl(url, loadingMsg.message_id, chatId);
      caption += `<a href="${shortUrl}">🔗 Enlace ${index + 1}</a>\n`;
    });
  }
  caption += `${SIGNATURE}${WARNING_MESSAGE}`;
  console.log('📝 Caption generado:', caption);

  try {
    console.log('📤 Enviando mensaje final...');
    let sentMessage;
    if (urls.length && !photo && !video && !animation) {
      console.log('📜 Caso 1: Solo enlaces');
      sentMessage = await bot.editMessageText(caption, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    } else if (photo && !urls.length && !video && !animation) {
      console.log('📷 Caso 2: Solo foto');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    } else if (video && !urls.length && !photo && !animation) {
      console.log('🎥 Caso 3: Solo video');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendVideo(chatId, video, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    } else if (animation && !urls.length && !photo && !video) {
      console.log('🎞️ Caso 4: Solo GIF');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    } else if (urls.length && photo && !video && !animation) {
      console.log('📷🔗 Caso 5: Enlaces + Foto');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendPhoto(chatId, photo, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    } else if (urls.length && video && !photo && !animation) {
      console.log('🎥🔗 Caso 6: Enlaces + Video');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendVideo(chatId, video, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    } else if (urls.length && animation && !photo && !video) {
      console.log('🎞️🔗 Caso 7: Enlaces + GIF');
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      sentMessage = await bot.sendAnimation(chatId, animation, {
        caption,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        protect_content: true,
      });
    } else {
      console.log('❌ Caso 8: Combinación no soportada');
      await bot.editMessageText('⚠️ Combinación no soportada. Usa enlaces con solo un tipo de multimedia (foto, video o GIF).', {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'HTML',
      });
      return;
    }

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

// Detectar reenvíos de mensajes y registrar en la base de datos
bot.on('message', async (msg) => {
  if (msg.forward_from || msg.forward_from_chat || msg.forward_from_message_id) {
    const forwardedMessageId = msg.forward_from_message_id;
    const forwardedFromChatId = msg.forward_from_chat ? msg.forward_from_chat.id : null;
    const forwardedByUser = msg.from;

    if (messageOrigins.has(forwardedMessageId)) {
      const origin = messageOrigins.get(forwardedMessageId);
      const originalChatId = origin.chat_id;
      const originalMessageText = origin.message_text;

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

      try {
        await bot.sendMessage(msg.chat.id, `🚨 Este mensaje es exclusivo para el grupo original. Por favor, no lo compartas.`, {
          parse_mode: 'HTML',
        });
        console.log(`✅ Advertencia enviada al usuario que reenvió (${forwardedByUser.id}) en el chat destino (${msg.chat.id})`);
      } catch (error) {
        console.error(`❌ Error al enviar advertencia al usuario que reenvió: ${error.message}`);
      }

      try {
        await bot.deleteMessage(msg.chat.id, msg.message_id);
        console.log(`✅ Mensaje reenviado eliminado del chat destino (${msg.chat.id})`);
      } catch (error) {
        console.error(`❌ Error al eliminar el mensaje reenviado del chat destino: ${error.message}`);
      }

      // Registrar el reenvío en la base de datos
      const details = `Reenviado a: ${msg.chat.title || msg.chat.id} (ID: ${msg.chat.id})`;
      db.run(
        `INSERT INTO interactions (type, chat_id, message_id, user_id, username, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['forward', originalChatId, forwardedMessageId, forwardedByUser.id, userName, new Date().toISOString(), details],
        (err) => {
          if (err) {
            console.error(`❌ Error al registrar el reenvío en la base de datos: ${err.message}`);
          } else {
            console.log(`✅ Reenvío registrado en la base de datos`);
          }
        }
      );
    }
  }
});

// Manejar clics en los enlaces acortados
app.get('/redirect/:shortId', (req, res) => {
  const shortId = req.params.shortId;
  if (!shortLinks.has(shortId)) {
    res.status(404).send('Enlace no encontrado');
    return;
  }

  const linkData = shortLinks.get(shortId);
  const originalUrl = linkData.original_url;
  const messageId = linkData.message_id;
  const chatId = linkData.chat_id;

  // Registrar el clic en la base de datos
  // Nota: No podemos obtener el usuario directamente desde la solicitud HTTP.
  // Esto requeriría un sistema de autenticación o un token en el enlace.
  // Por ahora, registraremos el clic sin información del usuario.
  const details = `Enlace clicado: ${originalUrl}`;
  db.run(
    `INSERT INTO interactions (type, chat_id, message_id, user_id, username, timestamp, details) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['click', chatId, messageId, 'unknown', 'unknown', new Date().toISOString(), details],
    (err) => {
      if (err) {
        console.error(`❌ Error al registrar el clic en la base de datos: ${err.message}`);
      } else {
        console.log(`✅ Clic registrado en la base de datos`);
      }
    }
  );

  // Redirigir al enlace original
  res.redirect(originalUrl);
});

// Comando /visto
bot.onText(/\/visto/, async (msg) => {
  const chatId = msg.chat.id;

  // Consultar los registros de interacciones desde la base de datos
  db.all(
    `SELECT * FROM interactions WHERE chat_id = ?`,
    [chatId],
    (err, records) => {
      if (err) {
        console.error(`❌ Error al consultar los registros de interacciones: ${err.message}`);
        bot.sendMessage(chatId, '⚠️ Ocurrió un error al obtener los registros de interacciones.');
        return;
      }

      if (records.length === 0) {
        bot.sendMessage(chatId, '📊 No hay registros de interacciones en este chat. 🕵️‍♂️');
        return;
      }

      let response = '<b>📊 Registros de interacciones:</b>\n\n';
      records.forEach(record => {
        response += `<b>📜 Mensaje ID:</b> ${record.message_id}\n`;
        response += `<b>🚨 Acción:</b> ${record.type === 'forward' ? 'Reenvió el mensaje' : 'Clic en enlace'}\n`;
        response += `<b>👤 Usuario:</b> ${record.username || 'Desconocido'}\n`;
        response += `<b>⏰ Hora:</b> ${new Date(record.timestamp).toLocaleString('es-ES')}\n`;
        response += `<b>ℹ️ Detalles:</b> ${record.details}\n\n`;
      });

      bot.sendMessage(chatId, response, { parse_mode: 'HTML' });
    }
  );
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

// Cerrar la base de datos al apagar el servidor
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('❌ Error al cerrar la base de datos:', err.message);
    }
    console.log('✅ Base de datos cerrada');
    process.exit(0);
  });
});