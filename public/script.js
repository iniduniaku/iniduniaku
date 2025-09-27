document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const loginScreen = document.getElementById('login-screen');
    const chatScreen = document.getElementById('chat-screen');
    const usernameInput = document.getElementById('username-input');
    const joinBtn = document.getElementById('join-btn');
    const loginError = document.getElementById('login-error');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const messagesContainer = document.getElementById('messages');
    const fileInput = document.getElementById('file-input');
    const attachmentPreview = document.getElementById('attachment-preview');
    const clearMessagesBtn = document.getElementById('clear-messages-btn');
    const typingIndicator = document.getElementById('typing-indicator');
    const typingUsername = document.getElementById('typing-username');
    
    // Header elements untuk user status
    const userStatusInfo = document.getElementById('user-status-info');
    const otherUserInfo = document.getElementById('other-user-info');
    const otherUsername = document.getElementById('other-username');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const lastSeen = document.getElementById('last-seen');
    
    // Reply elements
    const replyPreview = document.getElementById('reply-preview');
    const replyUsername = document.getElementById('reply-username');
    const replyText = document.getElementById('reply-text');
    const cancelReplyBtn = document.getElementById('cancel-reply');
    
    // Variables
    let socket;
    let currentUser;
    let currentMedia = null;
    let typingTimeout;
    let onlineUsers = [];
    let messagesData = {}; // Simpan data pesan lengkap dengan readBy
    let allUserLastSeen = {}; // Data last seen semua user
    let authorizedUsers = ['Azz', 'Queen']; // Default, akan diupdate dari server
    let replyToMessage = null; // Data pesan yang sedang direply
    
    // Initialize
    init();
    
    // Functions
    function init() {
        // Focus username input
        usernameInput.focus();
        
        // Enter key for login
        usernameInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && usernameInput.value.trim()) {
                joinChat();
            }
        });
        
        // Join button click
        joinBtn.addEventListener('click', function() {
            if (usernameInput.value.trim()) {
                joinChat();
            }
        });
        
        // Auto-resize message input
        messageInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = (this.scrollHeight) + 'px';
            
            // Enable/disable send button
            sendBtn.disabled = !this.value.trim() && !currentMedia;
            
            // Typing indicator
            if (this.value.trim()) {
                clearTimeout(typingTimeout);
                socket.emit('typing', true);
                
                typingTimeout = setTimeout(() => {
                    socket.emit('typing', false);
                }, 2000);
            } else {
                clearTimeout(typingTimeout);
                socket.emit('typing', false);
            }
        });
        
        // Send message on Enter (but Shift+Enter for new line)
        messageInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!sendBtn.disabled) {
                    sendMessage();
                }
            }
        });
        
        // Send button click
        sendBtn.addEventListener('click', sendMessage);
        
        // File input change
        fileInput.addEventListener('change', handleFileSelect);
        
        // Clear messages button
        clearMessagesBtn.addEventListener('click', confirmClearMessages);
        
        // Cancel reply button
        cancelReplyBtn.addEventListener('click', cancelReply);
        
        // Handle window resize
        window.addEventListener('resize', handleResize);
        
        // Handle Escape key untuk cancel reply
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && replyToMessage) {
                cancelReply();
            }
        });
    }
    
    function joinChat() {
        const username = usernameInput.value.trim();
        
        if (!username) {
            showLoginError('Silakan masukkan nama pengguna');
            return;
        }
        
        // Connect to socket
        socket = io();
        
        // Socket events
        socket.on('connect', function() {
            socket.emit('join', username);
        });

        socket.on('unauthorized', () => {
            showLoginError('Username tidak diizinkan! Hanya user yang terdaftar yang bisa masuk.');
        });
        
        socket.on('username_taken', function() {
            showLoginError('Nama pengguna sudah digunakan, silakan pilih yang lain');
        });
        
        socket.on('room_full', function() {
            showLoginError('Chat room penuh, silakan coba lagi nanti');
        });
        
        socket.on('load_messages', function(messages) {
            messagesContainer.innerHTML = '';
            messagesData = {}; // Reset
            
            messages.forEach(message => {
                messagesData[message.id] = message; // Simpan data lengkap
                displayMessage(message);
            });
            scrollToBottom();
        });
        
        socket.on('message_received', function(message) {
            messagesData[message.id] = message; // Simpan data lengkap
            displayMessage(message);
            scrollToBottom();
        });
        
        // Event untuk update status baca untuk semua user
        socket.on('read_status_update', function(data) {
            console.log('Read status update received:', data);
            updateReadStatus(data);
        });
        
        socket.on('user_list_update', function(data) {
            updateOnlineUsers(data);
        });
        
        socket.on('user_typing', function(data) {
            if (data.isTyping) {
                typingUsername.textContent = data.username;
                typingIndicator.classList.remove('hidden');
            } else {
                typingIndicator.classList.add('hidden');
            }
        });
        
        socket.on('messages_cleared', function() {
            messagesContainer.innerHTML = '';
            messagesData = {}; // Reset data pesan
            showSystemMessage('Semua pesan telah dihapus');
            cancelReply(); // Cancel reply jika ada
        });
        
        socket.on('user_joined', function(username) {
            showSystemMessage(`${username} bergabung dalam chat`);
        });
        
        socket.on('user_left', function(username) {
            showSystemMessage(`${username} meninggalkan chat`);
        });
        
        currentUser = username;
        loginScreen.classList.add('hidden');
        chatScreen.classList.remove('hidden');
        messageInput.focus();
    }
    
    function showLoginError(message) {
        loginError.textContent = message;
        usernameInput.classList.add('error');
        
        setTimeout(() => {
            usernameInput.classList.remove('error');
        }, 1000);
    }
    
    function sendMessage() {
        const text = messageInput.value.trim();
        
        if (!text && !currentMedia) return;
        
        const messageData = {
            text: text,
            type: currentMedia ? 'media' : 'text',
            media: currentMedia,
            replyTo: replyToMessage // Tambahkan data reply
        };
        
        socket.emit('new_message', messageData);
        
        // Reset input
        messageInput.value = '';
        messageInput.style.height = 'auto';
        currentMedia = null;
        attachmentPreview.innerHTML = '';
        sendBtn.disabled = true;
        
        // Reset reply
        cancelReply();
        
        // Reset typing
        clearTimeout(typingTimeout);
        socket.emit('typing', false);
        
        // Focus input
        messageInput.focus();
    }
    
    function displayMessage(message) {
        const template = document.getElementById('message-template');
        const messageEl = document.importNode(template.content, true).querySelector('.message');
        
        // Set message ID untuk tracking
        messageEl.setAttribute('data-message-id', message.id);
        
        // Check if own message
        if (message.username === currentUser) {
            messageEl.classList.add('own');
        }
        
        // Display replied message jika ada
        if (message.replyTo) {
            const repliedEl = messageEl.querySelector('.replied-message');
            const repliedUsernameEl = messageEl.querySelector('.replied-username');
            const repliedTextEl = messageEl.querySelector('.replied-text');
            
            repliedEl.classList.remove('hidden');
            repliedUsernameEl.textContent = message.replyTo.username;
            
            // Set replied text dengan truncation
            let replyDisplayText = '';
            if (message.replyTo.text) {
                replyDisplayText = message.replyTo.text.length > 50 ? 
                    message.replyTo.text.substring(0, 50) + '...' : 
                    message.replyTo.text;
            } else if (message.replyTo.media) {
                repliedTextEl.classList.add('has-media');
                const mediaIcon = getMediaIcon(message.replyTo.media.originalName);
                replyDisplayText = `${mediaIcon} ${message.replyTo.media.originalName || 'File'}`;
            }
            
            repliedTextEl.innerHTML = replyDisplayText;
            
            // Add click event untuk scroll ke pesan yang direply
            repliedEl.addEventListener('click', function() {
                scrollToMessage(message.replyTo.id);
            });
        }
        
        // Set username and time
        messageEl.querySelector('.message-username').textContent = message.username;
        
        const timestamp = new Date(message.timestamp);
        const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageEl.querySelector('.message-time').textContent = timeString;
        
        // Add reply button event
        const replyBtn = messageEl.querySelector('.reply-btn');
        replyBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            startReply(message);
        });
        
        // Set content
        const contentEl = messageEl.querySelector('.message-content');
        
        if (message.text) {
            contentEl.innerHTML += formatMessageText(message.text);
        }
        
        // Add media if present
        if (message.media) {
            const mediaPath = message.media.path;
            const fileExt = mediaPath.split('.').pop().toLowerCase();
            
            // Images
            if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
                const img = document.createElement('img');
                img.src = mediaPath;
                img.alt = 'Image';
                img.loading = 'lazy';
                contentEl.appendChild(img);
            }
            // Videos
            else if (['mp4', 'mov', 'avi', 'webm'].includes(fileExt)) {
                const video = document.createElement('video');
                video.src = mediaPath;
                video.controls = true;
                contentEl.appendChild(video);
            }
            // Audio
            else if (['mp3', 'wav', 'ogg', 'm4a'].includes(fileExt)) {
                const audio = document.createElement('audio');
                audio.src = mediaPath;
                audio.controls = true;
                contentEl.appendChild(audio);
            }
            // Documents
            else {
                const link = document.createElement('a');
                link.href = mediaPath;
                link.target = '_blank';
                link.textContent = message.media.originalName || 'Download File';
                
                const fileIcon = document.createElement('i');
                fileIcon.className = 'fas fa-file';
                fileIcon.style.marginRight = '5px';
                
                link.prepend(fileIcon);
                contentEl.appendChild(document.createElement('br'));
                contentEl.appendChild(link);
            }
        }
        
        // Set read status untuk pesan
        updateMessageReadStatusDisplay(messageEl, message);
        
        messagesContainer.appendChild(messageEl);
    }
    
    function startReply(message) {
        replyToMessage = {
            id: message.id,
            username: message.username,
            text: message.text,
            media: message.media
        };
        
        // Show reply preview
        replyPreview.classList.remove('hidden');
        replyUsername.textContent = message.username;
        
        // Set reply text dengan truncation
        let displayText = '';
        if (message.text) {
            displayText = message.text.length > 100 ? 
                message.text.substring(0, 100) + '...' : 
                message.text;
        } else if (message.media) {
            const mediaIcon = getMediaIcon(message.media.originalName);
            displayText = `${mediaIcon} ${message.media.originalName || 'File'}`;
        }
        
        replyText.innerHTML = displayText;
        
        // Focus message input
        messageInput.focus();
        
        // Highlight pesan yang sedang direply
        const messageEl = document.querySelector(`[data-message-id="${message.id}"]`);
        if (messageEl) {
            messageEl.classList.add('being-replied');
            setTimeout(() => {
                messageEl.classList.remove('being-replied');
            }, 1000);
        }
        
        // Update placeholder
        messageInput.placeholder = `Membalas ${message.username}...`;
    }
    
    function cancelReply() {
        replyToMessage = null;
        replyPreview.classList.add('hidden');
        messageInput.placeholder = 'Sampaikan perasaan...';
    }
    
    function scrollToMessage(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Highlight pesan
            const repliedEl = messageEl.querySelector('.replied-message');
            if (repliedEl) {
                repliedEl.classList.add('highlight');
                setTimeout(() => {
                    repliedEl.classList.remove('highlight');
                }, 2000);
            } else {
                messageEl.classList.add('being-replied');
                setTimeout(() => {
                    messageEl.classList.remove('being-replied');
                }, 2000);
            }
        }
    }
    
    function getMediaIcon(filename) {
        if (!filename) return '<i class="fas fa-file"></i>';
        
        const ext = filename.split('.').pop().toLowerCase();
        
        switch (ext) {
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'gif':
                return '<i class="fas fa-image"></i>';
            case 'mp4':
            case 'mov':
            case 'avi':
            case 'webm':
                return '<i class="fas fa-video"></i>';
            case 'mp3':
            case 'wav':
            case 'ogg':
            case 'm4a':
                return '<i class="fas fa-music"></i>';
            case 'pdf':
                return '<i class="fas fa-file-pdf"></i>';
            case 'doc':
            case 'docx':
                return '<i class="fas fa-file-word"></i>';
            default:
                return '<i class="fas fa-file"></i>';
        }
    }
    
    // Update fungsi updateOnlineUsers untuk header user status
    function updateOnlineUsers(data) {
        const users = data.users || data; // Support old format
        allUserLastSeen = data.allUserLastSeen || {};
        authorizedUsers = data.authorizedUsers || ['Azz', 'Queen'];
        
        onlineUsers = users;
        
        // Update header user status
        updateUserStatusHeader(users);
        
        // Update status baca berdasarkan data tersimpan
        updateAllReadStatusDisplay();
    }
    
    // Fungsi untuk update header status user - CLEANED
    function updateUserStatusHeader(users) {
        // Dapatkan username user lawan
        const otherUsername_val = authorizedUsers.find(username => username !== currentUser);
        
        if (!otherUsername_val) {
            // Tidak ada user lain yang authorized - sembunyikan info user
            otherUserInfo.classList.add('hidden');
            return;
        }
        
        // Cek apakah user lawan sedang online
        const otherUserOnline = users.find(user => user.username === otherUsername_val);
        
        // Selalu tampilkan info user lawan
        otherUserInfo.classList.remove('hidden');
        
        // Set nama user lawan
        otherUsername.textContent = otherUsername_val;
        
        if (otherUserOnline) {
            // User lawan online - hanya update dot, TIDAK menampilkan text "Online"
            statusDot.classList.remove('offline');
            statusDot.classList.add('online');
            statusText.style.display = 'none'; // Sembunyikan text status
            lastSeen.classList.add('hidden');
            
            console.log(`${otherUsername_val} is online`);
        } else {
            // User lawan offline
                        statusDot.classList.remove('online');
            statusDot.classList.add('offline');
            statusText.style.display = 'none'; // Sembunyikan text "Online"
            
            // Tampilkan last seen jika ada data
            const lastSeenTime = allUserLastSeen[otherUsername_val];
            if (lastSeenTime) {
                const lastSeenDate = new Date(lastSeenTime);
                const now = new Date();
                const diffMs = now - lastSeenDate;
                const diffMinutes = Math.floor(diffMs / (1000 * 60));
                const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
                
                let lastSeenText = '';
                if (diffMinutes < 1) {
                    lastSeenText = 'Baru saja terlihat';
                } else if (diffMinutes < 60) {
                    lastSeenText = `Terlihat ${diffMinutes} menit lalu`;
                } else if (diffHours < 24) {
                    lastSeenText = `Terlihat ${diffHours} jam lalu`;
                } else if (diffDays === 1) {
                    lastSeenText = 'Terlihat kemarin';
                } else if (diffDays < 7) {
                    lastSeenText = `Terlihat ${diffDays} hari lalu`;
                } else {
                    lastSeenText = `Terlihat ${lastSeenDate.toLocaleDateString()}`;
                }
                
                lastSeen.textContent = lastSeenText;
                lastSeen.classList.remove('hidden');
            } else {
                lastSeen.classList.add('hidden');
            }
            
            console.log(`${otherUsername_val} is offline, last seen:`, lastSeenTime);
        }
    }
    
    // Fungsi untuk update read status display untuk semua pesan
    function updateAllReadStatusDisplay() {
        const messageElements = messagesContainer.querySelectorAll('[data-message-id]');
        
        messageElements.forEach(messageEl => {
            const messageId = messageEl.getAttribute('data-message-id');
            const messageData = messagesData[messageId];
            
            if (messageData) {
                updateMessageReadStatusDisplay(messageEl, messageData);
            }
        });
    }
    
    // Fungsi untuk update status read pada elemen pesan tertentu
    function updateMessageReadStatusDisplay(messageEl, messageData) {
        const readStatusEl = messageEl.querySelector('.read-status');
        
        if (!readStatusEl || messageData.username !== currentUser) {
            // Hanya tampilkan status baca untuk pesan sendiri
            return;
        }
        
        // Hitung jumlah user lain yang sudah baca
        const otherUsersWhoRead = (messageData.readBy || []).filter(readUser => 
            readUser.username !== currentUser
        );
        
        if (otherUsersWhoRead.length > 0) {
            // Ada user lain yang sudah baca
            readStatusEl.innerHTML = '<i class="fas fa-check-double"></i>';
            readStatusEl.classList.add('read');
            readStatusEl.classList.remove('sent');
            
            // Tambahkan tooltip dengan info siapa yang sudah baca
            const readByNames = otherUsersWhoRead.map(user => user.username).join(', ');
            readStatusEl.title = `Dibaca oleh: ${readByNames}`;
        } else {
            // Belum dibaca oleh user lain
            readStatusEl.innerHTML = '<i class="fas fa-check"></i>';
            readStatusEl.classList.add('sent');
            readStatusEl.classList.remove('read');
            readStatusEl.title = 'Terkirim';
        }
    }
    
    // Fungsi untuk update read status dari server
    function updateReadStatus(data) {
        const { messageId, readBy } = data;
        
        // Update data lokal
        if (messagesData[messageId]) {
            messagesData[messageId].readBy = readBy;
        }
        
        // Update tampilan
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl && messagesData[messageId]) {
            updateMessageReadStatusDisplay(messageEl, messagesData[messageId]);
        }
    }
    
    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Check file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            alert('File terlalu besar! Maksimal 10MB');
            return;
        }
        
        const formData = new FormData();
        formData.append('file', file);
        
        // Show upload preview
        showUploadPreview(file);
        
        // Upload file
        fetch('/upload', {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                currentMedia = {
                    path: data.path,
                    originalName: data.originalName,
                    size: data.size
                };
                
                sendBtn.disabled = false;
                updateUploadPreview(file, true);
            } else {
                alert('Gagal mengunggah file: ' + data.message);
                clearUploadPreview();
            }
        })
        .catch(error => {
            console.error('Upload error:', error);
            alert('Gagal mengunggah file');
            clearUploadPreview();
        });
        
        // Reset file input
        fileInput.value = '';
    }
    
    function showUploadPreview(file) {
        const preview = document.createElement('div');
        preview.className = 'upload-preview';
        
        const fileName = document.createElement('span');
        fileName.className = 'file-name';
        fileName.textContent = file.name;
        
        const fileSize = document.createElement('span');
        fileSize.className = 'file-size';
        fileSize.textContent = formatFileSize(file.size);
        
        const spinner = document.createElement('div');
        spinner.className = 'upload-spinner';
        spinner.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-file-btn';
        removeBtn.innerHTML = '<i class="fas fa-times"></i>';
        removeBtn.onclick = clearUploadPreview;
        
        preview.appendChild(fileName);
        preview.appendChild(fileSize);
        preview.appendChild(spinner);
        preview.appendChild(removeBtn);
        
        attachmentPreview.innerHTML = '';
        attachmentPreview.appendChild(preview);
    }
    
    function updateUploadPreview(file, success) {
        const preview = attachmentPreview.querySelector('.upload-preview');
        if (!preview) return;
        
        const spinner = preview.querySelector('.upload-spinner');
        if (spinner) {
            if (success) {
                spinner.innerHTML = '<i class="fas fa-check"></i>';
                spinner.className = 'upload-success';
            } else {
                spinner.innerHTML = '<i class="fas fa-times"></i>';
                spinner.className = 'upload-error';
            }
        }
    }
    
    function clearUploadPreview() {
        attachmentPreview.innerHTML = '';
        currentMedia = null;
        sendBtn.disabled = !messageInput.value.trim();
    }
    
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    function formatMessageText(text) {
        // Format URLs menjadi link
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        text = text.replace(urlRegex, '<a href="\$1" target="_blank">$1</a>');
        
        // Format line breaks
        text = text.replace(/
/g, '<br>');
        
        // Format mentions (optional)
        const mentionRegex = /@(\w+)/g;
        text = text.replace(mentionRegex, '<span class="mention">@$1</span>');
        
        return text;
    }
    
    function confirmClearMessages() {
        if (confirm('Apakah Anda yakin ingin menghapus semua pesan? Tindakan ini tidak dapat dibatalkan.')) {
            socket.emit('clear_messages');
        }
    }
    
    function showSystemMessage(message) {
        const systemMsg = document.createElement('div');
        systemMsg.className = 'system-message';
        systemMsg.textContent = message;
        messagesContainer.appendChild(systemMsg);
        scrollToBottom();
    }
    
    function scrollToBottom() {
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 100);
    }
    
    function handleResize() {
        // Adjust messages container height on mobile
        if (window.innerWidth <= 768) {
            const vh = window.innerHeight * 0.01;
            document.documentElement.style.setProperty('--vh', `${vh}px`);
        }
    }
    
    // Initialize resize handler
    handleResize();
});
