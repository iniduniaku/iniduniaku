const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Web Push configuration
webpush.setVapidDetails(
  'mailto:imnothero02@gmail.com',
  'BMPWWbWCfZjmzJl0f1Sj2quA06CqZzkIcoZTgXqlSTCnxaQ-YX6favxpjzREbiijMtUHQYyhGfU_9T9AKroPIgM', // Public key
  'y4y49tjMj5DC9Jl5w9idJXsvl1vHEHnikdtV76jiUDE' // Private key
);

// Middleware
app.use(express.static('public'));
app.use(express.json());

// File paths
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const PUSH_SUBSCRIPTIONS_FILE = path.join(__dirname, 'push_subscriptions.json');
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
let pushSubscriptions = [];
let userLastSeen = {};
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

// Reply message utilities
function findMessageById(messageId) {
  return messages.find(msg => msg.id === messageId);
}

function formatReplyPreview(message) {
  if (!message) return null;
  
  let preview = '';
  if (message.media && message.media.originalName) {
    const emoji = getFileTypeEmoji(message.media.type, message.media.originalName);
    preview = `${emoji} ${message.media.originalName}`;
  } else if (message.text) {
    preview = message.text.length > 50 ? message.text.substring(0, 50) + '...' : message.text;
  } else {
    preview = 'Media file';
  }
  
  return {
    id: message.id,
    username: message.username,
    preview: preview,
    timestamp: message.timestamp,
    hasMedia: !!message.media,
    type: message.type || 'text'
  };
}

function validateReplyMessage(replyToId) {
  if (!replyToId) return { valid: true, parentMessage: null };
  
  const parentMessage = findMessageById(replyToId);
  if (!parentMessage) {
    return { valid: false, error: 'Parent message not found' };
  }
  
  // Cek apakah parent message sudah expired
  const now = new Date();
  const ageInHours = (now - new Date(parentMessage.timestamp)) / (1000 * 60 * 60);
  if (ageInHours >= MESSAGE_EXPIRY_HOURS) {
    return { valid: false, error: 'Parent message has expired' };
  }
  
  return { valid: true, parentMessage: parentMessage };
}

// Web Push Notification management
function loadPushSubscriptions() {
  try {
    if (fs.existsSync(PUSH_SUBSCRIPTIONS_FILE)) {
      const data = fs.readFileSync(PUSH_SUBSCRIPTIONS_FILE, 'utf8');
      pushSubscriptions = JSON.parse(data);
      console.log(`${getFormattedTimestamp()} Loaded ${pushSubscriptions.length} push subscriptions`);
    } else {
      pushSubscriptions = [];
      savePushSubscriptions();
      console.log(`${getFormattedTimestamp()} Created default push_subscriptions.json file`);
    }
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error loading push subscriptions:`, error);
    pushSubscriptions = [];
  }
}

function savePushSubscriptions() {
  try {
    fs.writeFileSync(PUSH_SUBSCRIPTIONS_FILE, JSON.stringify(pushSubscriptions, null, 2));
  } catch (error) {
    console.error(`${getFormattedTimestamp()} Error saving push subscriptions:`, error);
  }
}

function addPushSubscription(subscription, username) {
  // Cek apakah subscription sudah ada
  const existingIndex = pushSubscriptions.findIndex(
    sub => sub.endpoint === subscription.endpoint
  );
  
  if (existingIndex !== -1) {
    // Update existing subscription
    pushSubscriptions[existingIndex] = {
      ...subscription,
      username: username,
      timestamp: new Date().toISOString()
    };
    console.log(`${getFormattedTimestamp()} Updated push subscription for ${username}`);
  } else {
    // Add new subscription
    pushSubscriptions.push({
      ...subscription,
      username: username,
      timestamp: new Date().toISOString()
    });
    console.log(`${getFormattedTimestamp()} New push subscription added for ${username}`);
  }
  
  savePushSubscriptions();
  return true;
}

function removePushSubscription(endpoint) {
  const initialLength = pushSubscriptions.length;
  pushSubscriptions = pushSubscriptions.filter(sub => sub.endpoint !== endpoint);
  
  if (pushSubscriptions.length < initialLength) {
    savePushSubscriptions();
    console.log(`${getFormattedTimestamp()} Push subscription removed`);
    return true;
  }
  return false;
}

async function sendPushNotification(message) {
  const payload = JSON.stringify({
    title: `💬 Pesan baru dari ${message.username}`,
    body: message.replyTo && message.parentMessage 
      ? `Reply: ${message.text || 'Media file'}`
      : message.text || 'Media file',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: 'new-message',
    data: {
      messageId: message.id,
      username: message.username,
      timestamp: message.timestamp,
      isReply: !!message.replyTo
    },
    actions: [
      {
        action: 'view',
        title: 'Lihat Pesan'
      },
      {
        action: 'close',
        title: 'Tutup'
      }
    ]
  });

  // Kirim ke semua subscription kecuali pengirim pesan
  const activeSubscriptions = [];
  
  for (const subscription of pushSubscriptions) {
    // Jangan kirim notifikasi ke pengirim pesan sendiri
    if (subscription.username === message.username) continue;
    
    try {
      await webpush.sendNotification(subscription, payload);
      activeSubscriptions.push(subscription);
      console.log(`${getFormattedTimestamp()} 📱 Push notification sent to ${subscription.username}`);
    } catch (error) {
      console.error(`${getFormattedTimestamp()} ❌ Failed to send push notification to ${subscription.username}:`, error.message);
      
      // Hapus subscription yang tidak valid
      if (error.statusCode === 404 || error.statusCode === 410) {
        removePushSubscription(subscription.endpoint);
      }
    }
  }
  
  return activeSubscriptions.length;
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
      
      // Migrasi pesan lama yang tidak memiliki properti lengkap
      messages = messages.map(msg => {
        if (!msg.readBy) {
          msg.readBy = [];
        }
        if (!msg.replyTo) {
          msg.replyTo = null;
        }
        if (!msg.parentMessage) {
          msg.parentMessage = null;
        }
        if (!msg.id) {
          msg.id = Date.now() + Math.random(); // Generate ID untuk pesan lama
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
loadPushSubscriptions();
loadLastSeen();

// Start background tasks
setInterval(cleanExpiredMessages, 60 * 60 * 1000); // Cleanup setiap jam

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Web Push routes
app.post('/subscribe', (req, res) => {
  const { subscription, username } = req.body;
  
  if (!subscription || !username) {
    return res.status(400).json({ error: 'Subscription and username are required' });
  }
  
  if (!isUserAuthorized(username)) {
    return res.status(401).json({ error: 'Unauthorized user' });
  }
  
  const success = addPushSubscription(subscription, username);
  res.json({ 
    success: success, 
    message: 'Push subscription saved',
    totalSubscriptions: pushSubscriptions.length
  });
});

app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint is required' });
  }
  
  const success = removePushSubscription(endpoint);
  res.json({ 
    success: success, 
    message: success ? 'Push subscription removed' : 'Subscription not found',
    totalSubscriptions: pushSubscriptions.length
  });
});

app.get('/vapid-public-key', (req, res) => {
  res.json({
    publicKey: 'BEl62iUYgUivxIkv69yViUAiBgkSU8vI1e78e8uNz_3oCWf2UZkFPGzDhMkZJjN9Bp1P2MHPe_I9TjCzUdWO-Ag'
  });
});

app.get('/subscriptions', (req, res) => {
  res.json({
    subscriptions: pushSubscriptions.map(sub => ({
      username: sub.username,
      timestamp: sub.timestamp
    })),
    total: pushSubscriptions.length
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

// Socket.IO connection handling dengan fitur reply lengkap
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

  // Event handler untuk reply message
  socket.on('get_reply_preview', (messageId, callback) => {
    if (!socket.username) return;
    
    const parentMessage = findMessageById(messageId);
    if (parentMessage) {
      const preview = formatReplyPreview(parentMessage);
      callback({ success: true, preview: preview });
    } else {
      callback({ success: false, error: 'Message not found' });
    }
  });

  socket.on('new_message', async (data) => {
    if (!socket.username) return;

    // Validasi reply message jika ada
    let parentMessage = null;
    if (data.replyTo) {
      const validation = validateReplyMessage(data.replyTo);
      if (!validation.valid) {
        socket.emit('message_error', { 
          error: validation.error,
          originalData: data 
        });
        console.log(`${getFormattedTimestamp()} ❌ Reply validation failed for ${socket.username}: ${validation.error}`);
        return;
      }
      parentMessage = validation.parentMessage;
    }

    const message = {
      id: Date.now() + Math.random(),
      username: socket.username,
      text: data.text,
      media: data.media || null,
      timestamp: new Date(),
      type: data.type || 'text',
      readBy: [], // Inisialisasi kosong
      replyTo: data.replyTo || null, // ID pesan yang di-reply
      parentMessage: parentMessage ? formatReplyPreview(parentMessage) : null // Data lengkap parent message untuk tampilan
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
    
    // Kirim web push notification untuk pesan baru
    try {
      const notificationCount = await sendPushNotification(message);
      console.log(`${getFormattedTimestamp()} 📱 Push notifications sent to ${notificationCount} subscribers`);
    } catch (error) {
      console.error(`${getFormattedTimestamp()} ❌ Error sending push notifications:`, error);
    }
    
    const replyText = message.replyTo ? ' (reply)' : '';
    console.log(`${getFormattedTimestamp()} 💬 New message from ${socket.username}${replyText}: ${message.text ? message.text.substring(0, 50) + (message.text.length > 50 ? '...' : '') : 'Media file'}`);
  });

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

// Graceful shutdown (lanjutan)
process.on('SIGTERM', () => {
  console.log(`${getFormattedTimestamp()} SIGTERM received, shutting down gracefully`);
  
  // Save all data before shutdown
  saveMessages();
  saveAuthorizedUsers();
  savePushSubscriptions();
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
  savePushSubscriptions();
  saveLastSeen();
  
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
  const startMessage = `🚀 Server running on port ${PORT}`;
  console.log(`${getFormattedTimestamp()} ${startMessage}`);
  console.log(`${getFormattedTimestamp()} 📱 Web Push notifications active`);
  console.log(`${getFormattedTimestamp()} 📋 Registered push subscriptions: ${pushSubscriptions.length}`);
  console.log(`${getFormattedTimestamp()} 👥 Authorized users: ${authorizedUsers.map(u => u.username).join(', ')}`);
  console.log(`${getFormattedTimestamp()} 💬 Loaded messages: ${messages.length}`);
});
