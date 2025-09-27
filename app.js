const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Konfigurasi Telegram Bot
const TELEGRAM_BOT_TOKEN = '8072273456:AAEbb88epp_BccBWjKboJliue7jBUqtzFow';

// Middleware
app.use(express.static('public'));
app.use(express.json());

// File paths
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const TELEGRAM_CHAT_IDS_FILE = path.join(__dirname, 'telegram_chat_ids.json');
const LAST_SEEN_FILE = path.join(__dirname, 'last_seen.json');

// Setup multer untuk file upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'public/uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|pdf|doc|docx|txt|mp3|wav|ogg|webm|m4a/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed!'));
    }
  }
});

// Global variables
let connectedUsers = {};
let messages = [];
let authorizedUsers = [];
let telegramChatIds = [];
let userLastSeen = {};
let lastUpdateId = 0;
const MAX_USERS = 2;
const MESSAGE_EXPIRY_HOURS = 24;

// Utility functions
function getFormattedTimestamp() {
  const now = new Date();
  const date = now.toLocaleDateString('id-ID');
  const time = now.toLocaleTimeString('id-ID');
  return `[${date} ${time}]`;
}

function getTimeAgo(timestamp) {
  const now = new Date();
  const diff = now - new Date(timestamp);
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (minutes < 1) return 'Baru saja';
  if (minutes < 60) return `${minutes} menit yang lalu`;
  if (hours < 24) return `${hours} jam yang lalu`;
  if (days < 7) return `${days} hari yang lalu`;
  
  return new Date(timestamp).toLocaleDateString('id-ID');
}

function getDuration(startTime, endTime) {
  const duration = endTime - startTime;
  const hours = Math.floor(duration / (1000 * 60 * 60));
  const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((duration % (1000 * 60)) / 1000);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

function getOtherUser(currentUsername) {
  const allUsers = authorizedUsers.map(u => u.username);
  return allUsers.find(username => username !== currentUsername);
}

function getFileTypeEmoji(mediaType, filename) {
  if (!mediaType && !filename) return '📄';
  
  const extension = filename ? path.extname(filename).toLowerCase() : '';
  
  if (mediaType && mediaType.startsWith('image/')) return '🖼️';
  if (mediaType && mediaType.startsWith('video/')) return '🎥';
  if (mediaType && mediaType.startsWith('audio/')) return '🎵';
  
  switch (extension) {
    case '.pdf': return '📄';
    case '.doc':
    case '.docx': return '📝';
    case '.txt': return '📄';
    case '.mp3':
    case '.wav':
    case '.ogg':
    case '.m4a': return '🎵';
    case '.mp4':
    case '.mov':
    case '.avi':
    case '.webm': return '🎥';
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif': return '🖼️';
    default: return '📎';
  }
}

// Last seen management
function loadLastSeen() {
  try {
    if (fs.existsSync(LAST_SEEN_FILE)) {
      const data = fs.readFileSync(LAST_SEEN_FILE, 'utf8');
      userLastSeen = JSON.parse(data);
      console.log(`${getFormattedTimestamp()} Loaded last seen data for ${Object.keys(userLastSeen).length} users`);
    }
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error loading last seen data:`, error);
    userLastSeen = {};
  }
}

function saveLastSeen() {
  try {
    fs.writeFileSync(LAST_SEEN_FILE, JSON.stringify(userLastSeen, null, 2));
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error saving last seen data:`, error);
  }
}

function updateLastSeen(username) {
  userLastSeen[username] = new Date().toISOString();
  saveLastSeen();
}

// Telegram bot management
function loadTelegramChatIds() {
  try {
    if (fs.existsSync(TELEGRAM_CHAT_IDS_FILE)) {
      const data = fs.readFileSync(TELEGRAM_CHAT_IDS_FILE, 'utf8');
      telegramChatIds = JSON.parse(data);
      console.log(`${getFormattedTimestamp()} Loaded ${telegramChatIds.length} telegram chat IDs`);
    } else {
      telegramChatIds = [];
      saveTelegramChatIds();
      console.log(`${getFormattedTimestamp()} Created default telegram_chat_ids.json file`);
    }
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error loading telegram chat IDs:`, error);
    telegramChatIds = [];
  }
}

function saveTelegramChatIds() {
  try {
    fs.writeFileSync(TELEGRAM_CHAT_IDS_FILE, JSON.stringify(telegramChatIds, null, 2));
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error saving telegram chat IDs:`, error);
  }
}

function addChatId(chatId) {
  const chatIdStr = chatId.toString();
  if (!telegramChatIds.includes(chatIdStr)) {
    telegramChatIds.push(chatIdStr);
    saveTelegramChatIds();
    console.log(`${getFormattedTimestamp()} New telegram chat ID added: ${chatIdStr}`);
    return true;
  }
  return false;
}

function pollTelegramUpdates() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    return;
  }

  const data = JSON.stringify({
    offset: lastUpdateId + 1,
    limit: 10,
    timeout: 10
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${TELEGRAM_BOT_TOKEN}/getUpdates`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    let responseData = '';

    res.on('data', (chunk) => {
      responseData += chunk;
    });

    res.on('end', () => {
      try {
        const response = JSON.parse(responseData);
        
        if (response.ok && response.result.length > 0) {
          response.result.forEach(update => {
            lastUpdateId = update.update_id;
            
            if (update.message) {
              const chatId = update.message.chat.id;
              const text = update.message.text;
              const firstName = update.message.from.first_name || 'User';
              
              console.log(`${getFormattedTimestamp()} Telegram message: ${firstName} (${chatId}): ${text}`);
              
              if (text === '/start' || text === '/register') {
                const isNew = addChatId(chatId);
                
                const welcomeMessage = 
                  `👋 Halo ${firstName}!
`
                
                sendWelcomeMessage(chatId, welcomeMessage);
              }
            }
          });
        }
      } catch (error) {
        console.error(`${getFormattedTimestamp()} Error parsing telegram response:`, error);
      }
    });
  });

  req.on('error', (error) => {
    console.error(`${getFormattedTimestamp()} Error polling telegram updates:`, error.message);
  });

  req.write(data);
  req.end();
}

function sendWelcomeMessage(chatId, message) {
  const data = JSON.stringify({
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML'
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = https.request(options, (res) => {
    console.log(`${getFormattedTimestamp()} Welcome message sent to chat ${chatId}`);
  });

  req.on('error', (error) => {
    console.error(`${getFormattedTimestamp()} Error sending welcome message:`, error.message);
  });

  req.write(data);
  req.end();
}

// Fungsi untuk mengirim notifikasi pesan baru saja
function sendNewMessageNotification(message) {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE') {
    console.log(`${getFormattedTimestamp()} ⚠️  Telegram bot not configured, skipping notification`);
    return;
  }

  if (telegramChatIds.length === 0) {
    console.log(`${getFormattedTimestamp()} ⚠️  No telegram chat IDs registered, skipping notification`);
    return;
  }

  // Format notifikasi untuk pesan baru
  let notificationText = `💬 FILM BARU TELAH DI UPDATE
`

  // Kirim ke semua chat ID yang terdaftar
  telegramChatIds.forEach((chatId, index) => {
    const data = JSON.stringify({
      chat_id: chatId,
      text: notificationText,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      if (res.statusCode === 200) {
        console.log(`${getFormattedTimestamp()} 📱 New message notification sent to ${chatId}`);
      } else {
        console.log(`${getFormattedTimestamp()} ❌ Failed to send to ${chatId}: ${res.statusCode}`);
      }
    });

    req.on('error', (error) => {
      console.error(`${getFormattedTimestamp()} ❌ Error for chat ${chatId}:`, error.message);
    });

    req.write(data);
    req.end();

    // Small delay between requests
    if (index < telegramChatIds.length - 1) {
      setTimeout(() => {}, 100);
    }
  });
}

// User management
function loadAuthorizedUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      authorizedUsers = JSON.parse(data);
      console.log(`${getFormattedTimestamp()} Loaded ${authorizedUsers.length} authorized users`);
    } else {
      authorizedUsers = [
        { username: "Azz" },
        { username: "Queen" }
      ];
      saveAuthorizedUsers();
      console.log(`${getFormattedTimestamp()} Created default users.json file`);
    }
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error loading authorized users:`, error);
    authorizedUsers = [
      { username: "Azz" },
      { username: "Queen" }
    ];
  }
}

function saveAuthorizedUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(authorizedUsers, null, 2));
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error saving authorized users:`, error);
  }
}

function isUserAuthorized(username) {
  return authorizedUsers.some(user => user.username === username);
}

// Message management dengan reply
function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
      messages = JSON.parse(data);
      
      // Migrasi pesan lama yang tidak memiliki readBy property
      messages = messages.map(msg => {
        if (!msg.readBy) {
          msg.readBy = [];
        }
        // Migrasi pesan lama yang tidak memiliki replyTo property
        if (!msg.replyTo) {
          msg.replyTo = null;
        }
        return msg;
      });
      
      console.log(`${getFormattedTimestamp()} Loaded ${messages.length} messages from file`);
      cleanExpiredMessages();
    } else {
      messages = [];
      console.log(`${getFormattedTimestamp()} No existing messages file found, starting fresh`);
    }
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error loading messages:`, error);
    messages = [];
  }
}

function saveMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error saving messages:`, error);
  }
}

function deleteMediaFile(message) {
  if (message.media && message.media.path) {
    const filePath = path.join(__dirname, 'public', message.media.path);
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error(`${getFormattedTimestamp()} Gagal menghapus file ${filePath}:`, err);
        } else {
          console.log(`${getFormattedTimestamp()} Media dihapus: ${filePath}`);
        }
      });
    }
  }
}

function cleanExpiredMessages() {
  const now = new Date();
  const newMessages = [];

  for (const message of messages) {
    const ageInHours = (now - new Date(message.timestamp)) / (1000 * 60 * 60);
    if (ageInHours < MESSAGE_EXPIRY_HOURS) {
      newMessages.push(message);
    } else {
      deleteMediaFile(message);
    }
  }

  const removedCount = messages.length - newMessages.length;
  messages = newMessages;

  if (removedCount > 0) {
    console.log(`${getFormattedTimestamp()} Removed ${removedCount} expired messages`);
    saveMessages();
    io.emit('messages_cleaned', { removedCount });
  }
}

// Read status management
function markMessagesAsReadOnLogin(username) {
  let hasUpdates = false;
  const updatedMessages = [];
  
  messages.forEach(message => {
    // Jangan tandai pesan sendiri sebagai dibaca
    if (message.username !== username) {
      if (!message.readBy.includes(username)) {
        message.readBy.push(username);
        hasUpdates = true;
        updatedMessages.push(message);
        console.log(`${getFormattedTimestamp()} ✓ Message ${message.id} marked as read by ${username}`);
      }
    }
  });
  
  if (hasUpdates) {
    saveMessages();
    
    // Kirim update ke SEMUA user yang online, termasuk pengirim pesan
    io.emit('read_status_update', { 
      type: 'bulk_read',
      username: username,
      messages: messages,
      updatedMessages: updatedMessages
    });
    
    console.log(`${getFormattedTimestamp()} 📖 ${username} marked ${updatedMessages.length} messages as read`);
  }
}

function markMessageAsRead(messageId, username) {
  const message = messages.find(msg => msg.id === messageId);
  
  if (message && message.username !== username) {
    if (!message.readBy.includes(username)) {
      message.readBy.push(username);
      saveMessages();
      
      // Kirim update ke SEMUA user yang online
      io.emit('read_status_update', { 
        type: 'single_read',
        messageId: messageId, 
        readBy: message.readBy,
        reader: username,
        messageSender: message.username
      });
      
      console.log(`${getFormattedTimestamp()} ✓ Message ${messageId} from ${message.username} marked as read by ${username}`);
      return true;
    }
  }
  return false;
}

// Initialize data
loadAuthorizedUsers();
loadMessages();
loadTelegramChatIds();
loadLastSeen();

// Start background tasks
setInterval(pollTelegramUpdates, 5000); // Poll telegram setiap 5 detik
setInterval(cleanExpiredMessages, 60 * 60 * 1000); // Cleanup setiap jam

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/add-chat-id', (req, res) => {
  const { chatId } = req.body;
  
  if (!chatId) {
    return res.status(400).json({ error: 'Chat ID is required' });
  }
  
  const isNew = addChatId(chatId);
  res.json({ 
    success: true, 
    message: isNew ? 'Chat ID added successfully' : 'Chat ID already exists',
    chatId: chatId,
    totalChatIds: telegramChatIds.length
  });
});

app.get('/chat-ids', (req, res) => {
  res.json({
    chatIds: telegramChatIds,
    total: telegramChatIds.length
  });
});

app.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  res.json({
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    path: `/uploads/${req.file.filename}`
  });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`${getFormattedTimestamp()} User connected: ${socket.id}`);

  socket.on('join', (username) => {
    if (!isUserAuthorized(username)) {
      socket.emit('unauthorized');
      console.log(`${getFormattedTimestamp()} ❌ Unauthorized access attempt: ${username} (ID: ${socket.id})`);
      return;
    }

    if (Object.keys(connectedUsers).length >= MAX_USERS) {
      socket.emit('room_full');
      console.log(`${getFormattedTimestamp()} 🚫 Room full - ${username} tried to join (ID: ${socket.id})`);
      return;
    }

    const isTaken = Object.values(connectedUsers).some(user => user.username === username);
    if (isTaken) {
      socket.emit('username_taken');
      console.log(`${getFormattedTimestamp()} ⚠️  Username already taken: ${username} (ID: ${socket.id})`);
      return;
    }

    const joinTime = new Date();
    connectedUsers[socket.id] = {
      username,
      status: 'online',
      joinedAt: joinTime
    };

    socket.username = username;
    socket.joinTime = joinTime;
    
    // Update last seen saat login
    updateLastSeen(username);
    
    // Load dan kirim pesan ke user yang baru login
    socket.emit('load_messages', messages);
    
    // Tandai pesan sebagai dibaca setelah load pesan
    setTimeout(() => {
      markMessagesAsReadOnLogin(username);
    }, 100);
    
    // Kirim data user dengan info lengkap termasuk user lawan
    const usersWithStatus = Object.values(connectedUsers).map(user => ({
      ...user,
      lastSeen: userLastSeen[user.username],
      otherUser: getOtherUser(user.username)
    }));
    
    io.emit('user_list_update', {
      users: usersWithStatus,
      allUserLastSeen: userLastSeen,
      authorizedUsers: authorizedUsers.map(u => u.username)
    });
    
    socket.broadcast.emit('user_joined', username);
    
    console.log(`${getFormattedTimestamp()} ✅ ${username} joined the chat (ID: ${socket.id})`);
  });

  socket.on('new_message', (data) => {
    if (!socket.username) return;

    const message = {
      id: Date.now() + Math.random(),
      username: socket.username,
      text: data.text,
      media: data.media || null,
      timestamp: new Date(),
      type: data.type || 'text',
      readBy: [], // Inisialisasi kosong
      replyTo: data.replyTo || null // Tambahkan reply data
    };

    messages.push(message);
    saveMessages();
    
    // Broadcast pesan ke semua user
    io.emit('message_received', message);
    
    // Auto-mark sebagai dibaca untuk semua user yang SEDANG ONLINE
    const currentOnlineUsers = Object.values(connectedUsers)
      .filter(user => user.username !== socket.username)
      .map(user => user.username);
    
    if (currentOnlineUsers.length > 0) {
      // Tandai sebagai dibaca untuk user yang online (kecuali pengirim)
      currentOnlineUsers.forEach(username => {
        if (!message.readBy.includes(username)) {
          message.readBy.push(username);
        }
      });
      
      saveMessages();
      
      // Broadcast update status centang ke SEMUA user (termasuk pengirim)
      io.emit('read_status_update', { 
        type: 'auto_read',
        messageId: message.id, 
        readBy: message.readBy,
        messageSender: message.username
      });
      
      console.log(`${getFormattedTimestamp()} 📖 Message from ${socket.username} auto-marked as read by: ${currentOnlineUsers.join(', ')}`);
    }
    
    // HANYA kirim notifikasi Telegram untuk pesan baru
    sendNewMessageNotification(message);
    
    const replyText = message.replyTo ? ' (reply)' : '';
    console.log(`${getFormattedTimestamp()} ADA FILM BARU NIH );

  socket.on('typing', (isTyping) => {
    if (!socket.username) return;
    socket.broadcast.emit('user_typing', {
      username: socket.username,
      isTyping
    });
  });

  socket.on('mark_as_read', (messageId) => {
    if (!socket.username) return;
    markMessageAsRead(messageId, socket.username);
  });

  socket.on('clear_messages', () => {
    if (!socket.username) return;

    const messageCount = messages.length;
    messages.forEach(deleteMediaFile);
    messages = [];
    saveMessages();
    io.emit('messages_cleared');
    
    console.log(`${getFormattedTimestamp()} 🗑️  ${socket.username} cleared ${messageCount} messages`);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      // Update last seen saat logout
      updateLastSeen(socket.username);
      
      const leaveTime = new Date();
      const sessionDuration = socket.joinTime ? getDuration(socket.joinTime, leaveTime) : 'Unknown';
      
      delete connectedUsers[socket.id];
      
      // Kirim update dengan last seen data dan info user lawan
      const usersWithStatus = Object.values(connectedUsers).map(user => ({
        ...user,
        lastSeen: userLastSeen[user.username],
        otherUser: getOtherUser(user.username)
      }));
      
      io.emit('user_list_update', {
        users: usersWithStatus,
        allUserLastSeen: userLastSeen,
        authorizedUsers: authorizedUsers.map(u => u.username)
      });
      
      socket.broadcast.emit('user_left', socket.username);
      
      console.log(`${getFormattedTimestamp()} ❌ ${socket.username} left the chat (ID: ${socket.id}) - Session duration: ${sessionDuration}`);
    } else {
      console.log(`${getFormattedTimestamp()} 🔌 Anonymous user disconnected (ID: ${socket.id})`);
    }
  });
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error(`${getFormattedTimestamp()} Uncaught Exception:`, error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`${getFormattedTimestamp()} Unhandled Rejection at:`, promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`${getFormattedTimestamp()} SIGTERM received, shutting down gracefully`);
  
  // Save all data before shutdown
  saveMessages();
  saveAuthorizedUsers();
  saveTelegramChatIds();
  saveLastSeen();
  
  // Notify all connected users
  io.emit('server_shutdown', 'Server sedang restart, silakan refresh halaman');
  
  setTimeout(() => {
    process.exit(0);
  }, 1000);
});

process.on('SIGINT', () => {
  console.log(`${getFormattedTimestamp()} SIGINT received, shutting down gracefully`);
  
  // Save all data before shutdown
  saveMessages();
  saveAuthorizedUsers();
  saveTelegramChatIds();
  saveLastSeen();
  
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
  const startMessage = `🚀 Server running on port ${PORT}`;
  console.log(`${getFormattedTimestamp()} ${startMessage}`);
  console.log(`${getFormattedTimestamp()} 📱 Telegram polling active`);
  console.log(`${getFormattedTimestamp()} 📋 Registered chat IDs: ${telegramChatIds.length}`);
  console.log(`${getFormattedTimestamp()} 👥 Authorized users: ${authorizedUsers.map(u => u.username).join(', ')}`);
  console.log(`${getFormattedTimestamp()} 💬 Loaded messages: ${messages.length}`);
});
