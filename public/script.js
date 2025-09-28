// Global Variables
let socket;
let currentUser = '';
let isConnected = false;
let typingTimer;
let replyToMessage = null;
let selectedFile = null;
let pushSubscription = null;

// DOM Elements
const loginScreen = document.getElementById('loginScreen');
const chatScreen = document.getElementById('chatScreen');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const loginError = document.getElementById('loginError');
const errorText = document.getElementById('errorText');

// Chat Elements
const currentUserElement = document.getElementById('currentUser');
const onlineUsersElement = document.getElementById('onlineUsers');
const messageCountElement = document.getElementById('messageCount');
const messagesContainer = document.getElementById('messagesContainer');
const messagesList = document.getElementById('messagesList');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const filePreview = document.getElementById('filePreview');
const fileName = document.getElementById('fileName');
const fileSize = document.getElementById('fileSize');
const cancelFile = document.getElementById('cancelFile');
const loadingOverlay = document.getElementById('loadingOverlay');
const clearBtn = document.getElementById('clearBtn');
const logoutBtn = document.getElementById('logoutBtn');
const notificationBtn = document.getElementById('notificationBtn');
const charCount = document.getElementById('charCount');
const typingIndicator = document.getElementById('typingIndicator');
const typingUser = document.getElementById('typingUser');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');
const toastContainer = document.getElementById('toastContainer');

// Reply Elements
const replyPreview = document.getElementById('replyPreview');
const replyUsername = document.getElementById('replyUsername');
const replyMessage = document.getElementById('replyMessage');
const cancelReply = document.getElementById('cancelReply');

// Utility Functions
function formatTime(date) {
    return new Date(date).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileIcon(filename, mediaType = '') {
    const extension = filename.split('.').pop().toLowerCase();
    
    if (mediaType.startsWith('image/')) return 'fas fa-image';
    if (mediaType.startsWith('video/')) return 'fas fa-video';
    if (mediaType.startsWith('audio/')) return 'fas fa-music';
    
    switch (extension) {
        case 'pdf': return 'fas fa-file-pdf';
        case 'doc':
        case 'docx': return 'fas fa-file-word';
        case 'txt': return 'fas fa-file-alt';
        case 'mp3':
        case 'wav':
        case 'ogg':
        case 'm4a': return 'fas fa-music';
        case 'mp4':
        case 'mov':
        case 'avi':
        case 'webm': return 'fas fa-video';
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif': return 'fas fa-image';
        default: return 'fas fa-file';
    }
}

function showToast(message, type = 'info', duration = 5000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 
                 type === 'warning' ? 'fa-exclamation-triangle' : 
                 type === 'error' ? 'fa-times-circle' : 'fa-info-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease-out forwards';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

function showConnectionStatus(message, isError = false) {
    statusText.textContent = message;
    connectionStatus.style.display = 'block';
    connectionStatus.style.color = isError ? '#f53d3d' : '#10dc60';
    
    setTimeout(() => {
        connectionStatus.style.display = 'none';
    }, 3000);
}

function scrollToBottom() {
    const wrapper = document.querySelector('.messages-wrapper');
    wrapper.scrollTop = wrapper.scrollHeight;
}

function autoResizeTextarea() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
}

// Error Handling
function showLoginError(message) {
    errorText.textContent = message;
    loginError.style.display = 'flex';
    setTimeout(() => {
        loginError.style.display = 'none';
    }, 5000);
}

// Socket Connection
function initializeSocket() {
    socket = io();
    
    // Connection events
    socket.on('connect', () => {
        isConnected = true;
        showConnectionStatus('Terhubung ke server');
        console.log('Connected to server');
    });
    
    socket.on('disconnect', () => {
        isConnected = false;
        showConnectionStatus('Koneksi terputus', true);
        console.log('Disconnected from server');
    });
    
    socket.on('reconnect', () => {
        isConnected = true;
        showConnectionStatus('Berhasil terhubung kembali');
        if (currentUser) {
            socket.emit('join', currentUser);
        }
    });
    
    // Authentication events
    socket.on('unauthorized', () => {
        showLoginError('Username tidak diotorisasi!');
    });
    
    socket.on('username_taken', () => {
        showLoginError('Username sudah digunakan!');
    });
    
    socket.on('room_full', () => {
        showLoginError('Ruang chat penuh! Maksimal 2 pengguna.');
    });
    
    // Message events
    socket.on('load_messages', (messages) => {
        displayMessages(messages);
        updateMessageCount(messages.length);
    });
    
    socket.on('message_received', (message) => {
        displayMessage(message);
        updateMessageCount();
        
        // Play notification sound if not own message
        if (message.username !== currentUser) {
            playNotificationSound();
        }
    });
    
    socket.on('user_list_update', (data) => {
        updateUserList(data);
    });
    
    socket.on('user_joined', (username) => {
        showToast(`${username} bergabung ke chat`, 'success');
    });
    
    socket.on('user_left', (username) => {
        showToast(`${username} meninggalkan chat`, 'warning');
    });
    
    socket.on('user_typing', (data) => {
        showTypingIndicator(data.username, data.isTyping);
    });
    
    socket.on('messages_cleared', () => {
        messagesList.innerHTML = '';
        updateMessageCount(0);
        showToast('Semua pesan telah dihapus', 'info');
    });
    
    socket.on('messages_cleaned', (data) => {
        showToast(`${data.removedCount} pesan kadaluarsa telah dihapus`, 'info');
    });
    
    socket.on('read_status_update', (data) => {
        updateReadStatus(data);
    });
    
    socket.on('message_error', (data) => {
        showToast(data.error, 'error');
    });
    
    socket.on('server_shutdown', (message) => {
        showToast(message, 'warning', 10000);
    });
}

// Message Display Functions
function displayMessages(messages) {
    messagesList.innerHTML = '';
    messages.forEach(message => displayMessage(message, false));
    scrollToBottom();
}

function displayMessage(message, animate = true) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.username === currentUser ? 'own' : ''}`;
    messageElement.dataset.messageId = message.id;
    
    if (animate) {
        messageElement.style.animation = 'messageSlideIn 0.3s ease-out';
    }
    
    let replyHtml = '';
    if (message.replyTo && message.parentMessage) {
        replyHtml = `
            <div class="message-reply">
                <div class="reply-header">
                    <i class="fas fa-reply"></i>
                    <span class="reply-username">${message.parentMessage.username}</span>
                </div>
                <div class="reply-text">${message.parentMessage.preview}</div>
            </div>
        `;
    }
    
    let mediaHtml = '';
    if (message.media) {
        if (message.media.type.startsWith('image/')) {
            mediaHtml = `
                <div class="message-media">
                    <img src="${message.media.path}" alt="${message.media.originalName}" 
                         onclick="openMedia('${message.media.path}', '${message.media.originalName}')">
                </div>
            `;
        } else if (message.media.type.startsWith('video/')) {
            mediaHtml = `
                <div class="message-media">
                    <video controls>
                        <source src="${message.media.path}" type="${message.media.type}">
                        Browser Anda tidak mendukung video.
                    </video>
                </div>
            `;
        } else if (message.media.type.startsWith('audio/')) {
            mediaHtml = `
                <div class="message-media">
                    <audio controls>
                        <source src="${message.media.path}" type="${message.media.type}">
                        Browser Anda tidak mendukung audio.
                    </audio>
                </div>
            `;
        } else {
            mediaHtml = `
                <div class="file-attachment" onclick="downloadFile('${message.media.path}', '${message.media.originalName}')">
                    <div class="file-icon">
                        <i class="${getFileIcon(message.media.originalName, message.media.type)}"></i>
                    </div>
                    <div class="file-info">
                        <div class="file-name">${message.media.originalName}</div>
                        <div class="file-size">${formatFileSize(message.media.size)}</div>
                    </div>
                    <i class="fas fa-download"></i>
                </div>
            `;
        }
    }
    
    // Read status icons
    let readStatusHtml = '';
    if (message.username === currentUser) {
        const readByCount = message.readBy ? message.readBy.length : 0;
        readStatusHtml = `
            <div class="message-status">
                <i class="fas fa-check${readByCount > 0 ? '-double' : ''}" 
                   style="color: ${readByCount > 0 ? '#10dc60' : '#a0a0b3'}"></i>
            </div>
        `;
    }
    
    // Message actions
    let actionsHtml = '';
    if (message.username !== currentUser) {
        actionsHtml = `
            <div class="message-actions">
                <button class="action-btn" onclick="replyToMessage('${message.id}')">
                    <i class="fas fa-reply"></i> Balas
                </button>
            </div>
        `;
    }
    
    messageElement.innerHTML = `
        <div class="message-avatar">
            <i class="fas fa-user"></i>
        </div>
        <div class="message-content">
            <div class="message-header">
                <span class="message-username">${message.username}</span>
                <span class="message-time">${formatTime(message.timestamp)}</span>
            </div>
            <div class="message-bubble">
                ${replyHtml}
                ${message.text ? `<div class="message-text">${message.text}</div>` : ''}
                ${mediaHtml}
            </div>
            ${readStatusHtml}
            ${actionsHtml}
        </div>
    `;
    
    messagesList.appendChild(messageElement);
    
    if (animate) {
        scrollToBottom();
    }
}

function updateReadStatus(data) {
    if (data.type === 'single_read' || data.type === 'auto_read') {
        const messageElement = document.querySelector(`[data-message-id="${data.messageId}"]`);
        if (messageElement) {
            const statusIcon = messageElement.querySelector('.message-status i');
            if (statusIcon && data.readBy.length > 0) {
                statusIcon.className = 'fas fa-check-double';
                statusIcon.style.color = '#10dc60';
            }
        }
    } else if (data.type === 'bulk_read') {
        // Update multiple messages
        data.messages.forEach(message => {
            if (message.username === currentUser && message.readBy.length > 0) {
                const messageElement = document.querySelector(`[data-message-id="${message.id}"]`);
                if (messageElement) {
                    const statusIcon = messageElement.querySelector('.message-status i');
                    if (statusIcon) {
                        statusIcon.className = 'fas fa-check-double';
                        statusIcon.style.color = '#10dc60';
                    }
                }
            }
        });
    }
}

function updateUserList(data) {
    const onlineCount = data.users.length;
    onlineUsersElement.textContent = `${onlineCount} online`;
    
    // Update header with other user info if available
    const otherUser = data.users.find(u => u.username !== currentUser);
    if (otherUser) {
        const lastSeen = data.allUserLastSeen[otherUser.username];
        if (lastSeen) {
            const timeAgo = getTimeAgo(lastSeen);
            onlineUsersElement.textContent += ` • ${otherUser.username} terakhir aktif ${timeAgo}`;
        }
    }
}

function getTimeAgo(timestamp) {
    const now = new Date();
    const diff = now - new Date(timestamp);
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (minutes < 1) return 'baru saja';
    if (minutes < 60) return `${minutes} menit yang lalu`;
    if (hours < 24) return `${hours} jam yang lalu`;
    if (days < 7) return `${days} hari yang lalu`;
    
    return new Date(timestamp).toLocaleDateString('id-ID');
}

function updateMessageCount(count = null) {
    if (count === null) {
        count = messagesList.children.length;
    }
    messageCountElement.textContent = `${count} pesan`;
}

// Typing Indicator
function showTypingIndicator(username, isTyping) {
    if (isTyping) {
        typingUser.textContent = username;
        typingIndicator.style.display = 'flex';
        scrollToBottom();
    } else {
        typingIndicator.style.display = 'none';
    }
}

// Reply Functions
function replyToMessage(messageId) {
    socket.emit('get_reply_preview', messageId, (response) => {
        if (response.success) {
            replyToMessage = messageId;
            replyUsername.textContent = response.preview.username;
            replyMessage.textContent = response.preview.preview;
            replyPreview.style.display = 'flex';
            messageInput.focus();
        } else {
            showToast('Tidak dapat membalas pesan ini', 'error');
        }
    });
}

function cancelReplyMessage() {
    replyToMessage = null;
    replyPreview.style.display = 'none';
}

// File Handling
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
        showToast('Ukuran file maksimal 50MB', 'error');
        return;
    }
    
    selectedFile = file;
    fileName.innerHTML = `<i class="${getFileIcon(file.name, file.type)}"></i> ${file.name}`;
    fileSize.textContent = formatFileSize(file.size);
    filePreview.style.display = 'flex';
}

function cancelFileSelection() {
    selectedFile = null;
    filePreview.style.display = 'none';
    fileInput.value = '';
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append('media', file);
    
    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Upload failed');
        }
        
        return await response.json();
    } catch (error) {
        console.error('Upload error:', error);
        throw error;
    }
}

// Message Sending
async function sendMessage() {
    const text = messageInput.value.trim();
    
    if (!text && !selectedFile) return;
    
    if (text.length > 2000) {
        showToast('Pesan terlalu panjang (maksimal 2000 karakter)', 'error');
        return;
    }
    
    let mediaData = null;
    
    if (selectedFile) {
        loadingOverlay.style.display = 'flex';
        try {
            mediaData = await uploadFile(selectedFile);
            mediaData.type = selectedFile.type;
            mediaData.size = selectedFile.size;
        } catch (error) {
            loadingOverlay.style.display = 'none';
            showToast('Gagal mengupload file', 'error');
            return;
        }
        loadingOverlay.style.display = 'none';
    }
    
    const messageData = {
        text: text,
        media: mediaData,
        type: mediaData ? 'media' : 'text',
        replyTo: replyToMessage
    };
    
    socket.emit('new_message', messageData);
    
    // Clear input
    messageInput.value = '';
    charCount.textContent = '0';
    autoResizeTextarea();
    
    // Clear file selection
    if (selectedFile) {
        cancelFileSelection();
    }
    
    // Clear reply
    if (replyToMessage) {
        cancelReplyMessage();
    }
    
    // Stop typing indicator
    socket.emit('typing', false);
}

// Media Functions
function openMedia(path, name) {
    const link = document.createElement('a');
    link.href = path;
    link.target = '_blank';
    link.click();
}

function downloadFile(path, name) {
    const link = document.createElement('a');
    link.href = path;
    link.download = name;
    link.click();
}

// Notification Functions
function playNotificationSound() {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmAcBjuW3O6/diMFl');
    audio.volume = 0.3;
    audio.play().catch(() => {}); // Ignore errors
}

// Web Push Notifications
async function initializePushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.log('Push notifications not supported');
        return;
    }
    
    try {
        // Register service worker
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('Service Worker registered');
        
        // Get VAPID public key
        const response = await fetch('/vapid-public-key');
        const { publicKey } = await response.json();
        
        // Subscribe to push notifications
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: publicKey
        });
        
        // Send subscription to server
        await fetch('/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                subscription,
                username: currentUser
            })
        });
        
        pushSubscription = subscription;
        updateNotificationButton(true);
        console.log('Push notifications enabled');
        
    } catch (error) {
        console.error('Failed to initialize push notifications:', error);
    }
}

async function togglePushNotifications() {
    if (!pushSubscription) {
        // Request permission
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            await initializePushNotifications();
            showToast('Notifikasi push diaktifkan', 'success');
        } else {
            showToast('Izin notifikasi ditolak', 'error');
        }
    } else {
        // Unsubscribe
        try {
            await pushSubscription.unsubscribe();
            await fetch('/unsubscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    endpoint: pushSubscription.endpoint
                })
            });
            
            pushSubscription = null;
            updateNotificationButton(false);
            showToast('Notifikasi push dinonaktifkan', 'info');
        } catch (error) {
            console.error('Failed to unsubscribe:', error);
            showToast('Gagal menonaktifkan notifikasi', 'error');
        }
    }
}

function updateNotificationButton(enabled) {
    const icon = notificationBtn.querySelector('i');
    if (enabled) {
        icon.className = 'fas fa-bell';
        notificationBtn.style.color = '#10dc60';
        notificationBtn.title = 'Notifikasi aktif - klik untuk menonaktifkan';
    } else {
        icon.className = 'fas fa-bell-slash';
        notificationBtn.style.color = '#a0a0b3';
        notificationBtn.title = 'Notifikasi nonaktif - klik untuk mengaktifkan';
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Initialize socket
    initializeSocket();
    
    // Login form
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = usernameInput.value.trim();
        
        if (!username) {
            showLoginError('Masukkan username!');
            return;
        }
        
        if (username.length > 20) {
            showLoginError('Username maksimal 20 karakter!');
            return;
        }
        
        currentUser = username;
        currentUserElement.textContent = username;
        socket.emit('join', username);
        
        // Hide login screen and show chat
        loginScreen.style.display = 'none';
        chatScreen.style.display = 'flex';
        
        // Initialize push notifications after successful login
        setTimeout(() => {
            if (Notification.permission === 'granted') {
                initializePushNotifications();
            }
        }, 1000);
    });
    
    // Message input
    messageInput.addEventListener('input', (e) => {
        const text = e.target.value;
        charCount.textContent = text.length;
        
        // Auto resize
        autoResizeTextarea();
        
        // Typing indicator
        clearTimeout(typingTimer);
        socket.emit('typing', true);
        
        typingTimer = setTimeout(() => {
            socket.emit('typing', false);
        }, 1000);
        
        // Update send button state
        sendBtn.disabled = !text.trim() && !selectedFile;
    });
    
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
    
    // Buttons
    sendBtn.addEventListener('click', sendMessage);
    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    cancelFile.addEventListener('click', cancelFileSelection);
    cancelReply.addEventListener('click', cancelReplyMessage);
    
    clearBtn.addEventListener('click', () => {
        if (confirm('Yakin ingin menghapus semua pesan?')) {
            socket.emit('clear_messages');
        }
    });
    
    logoutBtn.addEventListener('click', () => {
        if (confirm('Yakin ingin keluar dari chat?')) {
            location.reload();
        }
    });
    
    notificationBtn.addEventListener('click', togglePushNotifications);
    
    // Focus message input when chat screen is shown
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target === chatScreen && chatScreen.style.display === 'flex') {
                setTimeout(() => messageInput.focus(), 100);
            }
        });
    });
    
    observer.observe(chatScreen, { attributes: true, attributeFilter: ['style'] });
});

// Global functions for HTML onclick events
window.replyToMessage = replyToMessage;
window.openMedia = openMedia;
window.downloadFile = downloadFile;

// Add CSS animation for toast slide out
const style = document.createElement('style');
style.textContent = `
@keyframes toastSlideOut {
    to {
        opacity: 0;
        transform: translateX(100%);
    }
}
`;
document.head.appendChild(style);
