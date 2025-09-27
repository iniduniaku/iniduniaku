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
    const cancelReplyBtn = document.getElementById('cancel-reply-btn');
    
    // Variables
    let socket;
    let currentUser;
    let currentMedia = null;
    let typingTimeout;
    let onlineUsers = [];
    let messagesData = {}; // Simpan data pesan lengkap dengan readBy
    let allUserLastSeen = {}; // Data last seen semua user
    let authorizedUsers = ['Azz', 'Queen']; // Default, akan diupdate dari server
    let replyingTo = null; // Message yang sedang direply
    let contextMenu = null; // Context menu element
    
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
        if (cancelReplyBtn) {
            cancelReplyBtn.addEventListener('click', cancelReply);
        }
        
        // Handle window resize
        window.addEventListener('resize', handleResize);
        
        // Close context menu on click outside
        document.addEventListener('click', function(e) {
            if (contextMenu && !contextMenu.contains(e.target)) {
                closeContextMenu();
            }
        });
        
        // Close context menu on scroll
        messagesContainer.addEventListener('scroll', closeContextMenu);
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
            cancelReply(); // Cancel any active reply
            showSystemMessage('Semua pesan telah dihapus');
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
            replyTo: replyingTo // Include reply data
        };
        
        socket.emit('new_message', messageData);
        
        // Reset input
        messageInput.value = '';
        messageInput.style.height = 'auto';
        currentMedia = null;
        attachmentPreview.innerHTML = '';
        sendBtn.disabled = true;
        
        // Cancel reply
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
        
        // Add reply message class if this is a reply
        if (message.replyTo) {
            messageEl.classList.add('reply-message');
        }
        
        // Set username and time
        messageEl.querySelector('.message-username').textContent = message.username;
        
        const timestamp = new Date(message.timestamp);
        const timeString = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        messageEl.querySelector('.message-time').textContent = timeString;
        
        // Set content
        const contentEl = messageEl.querySelector('.message-content');
        
        // Add reply section if this message is a reply
        if (message.replyTo) {
            const replySection = createReplySection(message.replyTo);
            contentEl.appendChild(replySection);
        }
        
        if (message.text) {
            const textDiv = document.createElement('div');
            textDiv.className = 'message-text';
            textDiv.innerHTML = formatMessageText(message.text);
            contentEl.appendChild(textDiv);
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
                img.addEventListener('click', () => openMediaModal(mediaPath, 'image'));
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
        
        // Add context menu functionality
        addContextMenuToMessage(messageEl, message);
        
        // Set read status untuk pesan
        updateMessageReadStatusDisplay(messageEl, message);
        
        messagesContainer.appendChild(messageEl);
    }
    
    function createReplySection(replyToMessage) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'message-reply';
        replyDiv.addEventListener('click', () => scrollToMessage(replyToMessage.id));
        
        const replySender = document.createElement('div');
        replySender.className = 'reply-sender';
        replySender.textContent = replyToMessage.username;
        
        const replyPreview = document.createElement('div');
        replyPreview.className = 'reply-preview-text';
        
        // Preview text or media
        if (replyToMessage.text) {
            replyPreview.textContent = replyToMessage.text.length > 50 ? 
                replyToMessage.text.substring(0, 47) + '...' : replyToMessage.text;
        } else if (replyToMessage.media) {
            const fileExt = replyToMessage.media.path.split('.').pop().toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
                replyPreview.innerHTML = '<i class="fas fa-image"></i> Foto';
            } else if (['mp4', 'mov', 'avi', 'webm'].includes(fileExt)) {
                replyPreview.innerHTML = '<i class="fas fa-video"></i> Video';
            } else if (['mp3', 'wav', 'ogg', 'm4a'].includes(fileExt)) {
                replyPreview.innerHTML = '<i class="fas fa-music"></i> Audio';
            } else {
                replyPreview.innerHTML = '<i class="fas fa-file"></i> File';
            }
        }
        
        replyDiv.appendChild(replySender);
        replyDiv.appendChild(replyPreview);
        
        return replyDiv;
    }
    
    function addContextMenuToMessage(messageEl, message) {
        messageEl.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showContextMenu(e, message);
        });
        
        // For mobile - long press
        let longPressTimer;
        messageEl.addEventListener('touchstart', function(e) {
            longPressTimer = setTimeout(() => {
                e.preventDefault();
                showContextMenu(e.touches[0], message);
            }, 500);
        });
        
        messageEl.addEventListener('touchend', function() {
            clearTimeout(longPressTimer);
        });
        
        messageEl.addEventListener('touchmove', function() {
            clearTimeout(longPressTimer);
        });
    }
    
    function showContextMenu(e, message) {
        closeContextMenu(); // Close any existing menu
        
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        
        // Reply option
        const replyItem = document.createElement('div');
        replyItem.className = 'context-menu-item';
        replyItem.innerHTML = '<i class="fas fa-reply"></i> Balas';
        replyItem.addEventListener('click', () => {
            startReply(message);
            closeContextMenu();
        });
        menu.appendChild(replyItem);
        
        // Copy text option (if message has text)
        if (message.text) {
            const copyItem = document.createElement('div');
            copyItem.className = 'context-menu-item';
            copyItem.innerHTML = '<i class="fas fa-copy"></i> Salin Teks';
            copyItem.addEventListener('click', () => {
                copyToClipboard(message.text);
                closeContextMenu();
            });
            menu.appendChild(copyItem);
        }
        
        // Delete option (only for own messages)
        if (message.username === currentUser) {
            const deleteItem = document.createElement('div');
            deleteItem.className = 'context-menu-item delete';
            deleteItem.innerHTML = '<i class="fas fa-trash"></i> Hapus';
            deleteItem.addEventListener('click', () => {
                deleteMessage(message.id);
                closeContextMenu();
            });
            menu.appendChild(deleteItem);
        }
        
        // Position menu
        const x = e.clientX || e.pageX;
        const y = e.clientY || e.pageY;
        
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        
        // Add to DOM
        document.body.appendChild(menu);
        contextMenu = menu;
        
        // Adjust position if menu goes off screen
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = (x - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = (y - rect.height) + 'px';
        }
        
        // Add overlay to close menu
        const overlay = document.createElement('div');
        overlay.className = 'context-menu-overlay';
        overlay.addEventListener('click', closeContextMenu);
        document.body.appendChild(overlay);
        
        // Animation
        menu.style.opacity = '0';
        menu.style.transform = 'scale(0.8)';
        setTimeout(() => {
            menu.style.opacity = '1';
            menu.style.transform = 'scale(1)';
        }, 10);
    }
    
    function closeContextMenu() {
        if (contextMenu) {
            contextMenu.remove();
            contextMenu = null;
        }
        
        const overlay = document.querySelector('.context-menu-overlay');
        if (overlay) {
            overlay.remove();
        }
    }
    
    function startReply(message) {
        replyingTo = message;
        
        // Show reply preview
        replyPreview.classList.remove('hidden');
        replyUsername.textContent = message.username;
        
        // Set preview text
        if (message.text) {
            replyText.textContent = message.text.length > 100 ? 
                message.text.substring(0, 97) + '...' : message.text;
        } else if (message.media) {
            const fileExt = message.media.path.split('.').pop().toLowerCase();
            if (['jpg', 'jpeg', 'png', 'gif'].includes(fileExt)) {
                replyText.innerHTML = '<i class="fas fa-image"></i> Foto';
            } else if (['mp4', 'mov', 'avi', 'webm'].includes(fileExt)) {
                replyText.innerHTML = '<i class="fas fa-video"></i> Video';
            } else if (['mp3', 'wav', 'ogg', 'm4a'].includes(fileExt)) {
                replyText.innerHTML = '<i class="fas fa-music"></i> Audio';
            } else {
                replyText.innerHTML = '<i class="fas fa-file"></i> File';
            }
        }
        
        // Focus message input
        messageInput.focus();
        
        // Update send button state
        sendBtn.disabled = !messageInput.value.trim() && !currentMedia;
        
        // Animate reply preview
        replyPreview.style.transform = 'translateY(-10px)';
        setTimeout(() => {
            replyPreview.style.transform = 'translateY(0)';
        }, 100);
    }
    
    function cancelReply() {
        replyingTo = null;
        replyPreview.classList.add('hidden');
        
        // Update send button state
        sendBtn.disabled = !messageInput.value.trim() && !currentMedia;
    }
    
    function scrollToMessage(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageEl) {
            messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Highlight message temporarily
            messageEl.classList.add('selected');
            setTimeout(() => {
                messageEl.classList.remove('selected');
            }, 2000);
        }
    }
    
    function copyToClipboard(text) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(() => {
                showToast('Teks disalin ke clipboard');
            });
        } else {
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            showToast('Teks disalin ke clipboard');
        }
    }
    
    function deleteMessage(messageId) {
        if (confirm('Hapus pesan ini?')) {
            socket.emit('delete_message', messageId);
        }
    }
    
    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('show');
        }, 100);
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                document.body.removeChild(toast);
            }, 300);
        }, 2000);
    }
    
    function openMediaModal(src, type) {
        const modal = document.createElement('div');
        modal.className = 'media-modal';
        modal.innerHTML = `
            <div class="media-modal-content">
                <button class="media-modal-close">&times;</button>
                ${type === 'image' ? `<img src="${src}" alt="Image">` : `<video src="${src}" controls></video>`}
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close modal events
        modal.addEventListener('click', function(e) {
            if (e.target === modal || e.target.classList.contains('media-modal-close')) {
                document.body.removeChild(modal);
            }
        });
        
        // ESC key to close
        const closeHandler = function(e) {
            if (e.key === 'Escape') {
                document.body.removeChild(modal);
                document.removeEventListener('keydown', closeHandler);
            }
        };
        document.addEventListener('keydown', closeHandler);
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
            statusText.style.display = 'none'; // Sembunyikan text status
            
            // Tampilkan waktu terakhir online
            if (allUserLastSeen[otherUsername_val]) {
                const timeAgo = getTimeAgo(allUserLastSeen[otherUsername_val]);
                lastSeen.textContent = `Terakhir dilihat ${timeAgo}`;
                lastSeen.classList.remove('hidden');
            } else {
                lastSeen.textContent = 'Belum pernah online';
                lastSeen.classList.remove('hidden');
            }
            
            console.log(`${otherUsername_val} is offline`);
        }
    }
    
    // Fungsi untuk menghitung time ago
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
    
    // Fungsi untuk menentukan status baca pesan untuk SEMUA USER
    function getReadStatus(message) {
        if (message.username !== currentUser) {
            return null; // Bukan pesan sendiri, tidak perlu status
        }
        
        // Dapatkan user lain selain pengirim dari daftar authorized yang diterima dari server
        const otherUsers = authorizedUsers.filter(user => user !== currentUser);
        
        if (otherUsers.length === 0) {
            return 'sent'; // Tidak ada user lain
        }
        
        // Cek berdasarkan data readBy yang tersimpan
        const readByArray = message.readBy || [];
        const unreadUsers = otherUsers.filter(user => !readByArray.includes(user));
        
        if (unreadUsers.length === 0) {
            return 'read'; // Semua sudah baca (biru)
        } else {
            return 'delivered'; // Ada yang belum baca (abu-abu)
        }
    }
    
    // Fungsi untuk mengupdate tampilan status baca pada pesan
    function updateMessageReadStatusDisplay(messageEl, message) {
        const statusEl = messageEl.querySelector('.read-status');
        if (!statusEl) return;
        
        const readStatus = getReadStatus(message);
        
        // Reset classes
        statusEl.classList.remove('sent', 'delivered', 'read');
        
        if (readStatus) {
            statusEl.classList.add(readStatus);
            statusEl.style.display = 'inline-block';
            
            // Update icon berdasarkan status
            const iconEl = statusEl.querySelector('i');
            if (readStatus === 'read') {
                iconEl.className = 'fas fa-check-double'; // Double check biru
                statusEl.title = 'Sudah dibaca';
            } else if (readStatus === 'delivered') {
                iconEl.className = 'fas fa-check'; // Single check abu-abu
                statusEl.title = 'Terkirim';
            } else {
                iconEl.className = 'fas fa-check'; // Single check abu-abu
                statusEl.title = 'Terkirim';
            }
        } else {
            statusEl.style.display = 'none';
        }
    }
    
    // Fungsi untuk mengupdate status baca dari server untuk SEMUA USER
    function updateReadStatus(data) {
        console.log('Updating read status with data:', data);
        
        if (data.type === 'single_read' && data.messageId) {
            // Update pesan specific
            const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageEl && messagesData[data.messageId]) {
                // Update data tersimpan
                messagesData[data.messageId].readBy = data.readBy || [];
                // Update tampilan untuk SEMUA user (pengirim dan penerima)
                updateMessageReadStatusDisplay(messageEl, messagesData[data.messageId]);
                console.log(`Message ${data.messageId} read status updated for all users`);
            }
        } else if (data.type === 'bulk_read') {
            // Update semua pesan (saat user login)
            if (data.messages) {
                data.messages.forEach(message => {
                    // Update data tersimpan
                    messagesData[message.id] = message;
                    
                    const messageEl = document.querySelector(`[data-message-id="${message.id}"]`);
                    if (messageEl) {
                        updateMessageReadStatusDisplay(messageEl, message);
                    }
                });
            }
            console.log(`Bulk read status updated for user: ${data.username}`);
        } else if (data.type === 'auto_read' && data.messageId) {
            // Update untuk auto-read saat pesan baru dikirim ke user online
            const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageEl && messagesData[data.messageId]) {
                // Update data tersimpan
                messagesData[data.messageId].readBy = data.readBy || [];
                // Update tampilan untuk SEMUA user
                updateMessageReadStatusDisplay(messageEl, messagesData[data.messageId]);
                console.log(`Message ${data.messageId} auto-read status updated for all users`);
            }
        }
    }
    
    // Fungsi untuk mengupdate status baca semua pesan berdasarkan data tersimpan
    function updateAllReadStatusDisplay() {
        Object.keys(messagesData).forEach(messageId => {
            const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageEl) {
                updateMessageReadStatusDisplay(messageEl, messagesData[messageId]);
            }
        });
    }
    
    function formatMessageText(text) {
        // Replace URLs with clickable links
        return text.replace(
            /(https?:\/\/[^\s]+)/g, 
            '<a href="\$1" target="_blank">$1</a>'
        ).replace(/
/g, '<br>');
    }
    
    function showSystemMessage(text) {
        const messageEl = document.createElement('div');
        messageEl.className = 'system-message';
        messageEl.textContent = text;
        messagesContainer.appendChild(messageEl);
        scrollToBottom();
    }
    
    function handleFileSelect(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        // Check file size (max 50MB)
        if (file.size > 50 * 1024 * 1024) {
            alert('File terlalu besar. Maksimal 50MB.');
            fileInput.value = '';
            return;
        }
        
        const reader = new FileReader();
        
        reader.onload = function(e) {
            attachmentPreview.innerHTML = '';
            
            const previewItem = document.createElement('div');
            previewItem.className = 'attachment-item';
            
            // Check file type
            const fileType = file.type.split('/')[0];
            
            if (fileType === 'image') {
                const img = document.createElement('img');
                img.src = e.target.result;
                                previewItem.appendChild(img);
            } else {
                const icon = document.createElement('div');
                icon.className = 'file-icon';
                
                if (fileType === 'video') {
                    icon.innerHTML = '<i class="fas fa-file-video"></i>';
                } else if (fileType === 'audio') {
                    icon.innerHTML = '<i class="fas fa-file-audio"></i>';
                } else {
                    icon.innerHTML = '<i class="fas fa-file"></i>';
                }
                
                const fileName = document.createElement('div');
                fileName.className = 'file-name';
                fileName.textContent = file.name.length > 20 ? 
                    file.name.substring(0, 17) + '...' : file.name;
                
                previewItem.appendChild(icon);
                previewItem.appendChild(fileName);
            }
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-attachment';
            removeBtn.innerHTML = '<i class="fas fa-times"></i>';
            removeBtn.addEventListener('click', function() {
                attachmentPreview.innerHTML = '';
                fileInput.value = '';
                currentMedia = null;
                sendBtn.disabled = !messageInput.value.trim() && !replyingTo;
            });
            
            previewItem.appendChild(removeBtn);
            attachmentPreview.appendChild(previewItem);
            
            // Upload file to server
            uploadFile(file);
        };
        
        reader.readAsDataURL(file);
    }
    
    function uploadFile(file) {
        const formData = new FormData();
        formData.append('media', file);
        
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
            } else {
                throw new Error(data.error || 'Upload failed');
            }
        })
        .catch(error => {
            console.error('Error uploading file:', error);
            alert('Gagal mengunggah file. Silakan coba lagi.');
            attachmentPreview.innerHTML = '';
            fileInput.value = '';
            currentMedia = null;
            sendBtn.disabled = !messageInput.value.trim() && !replyingTo;
        });
    }
    
    function confirmClearMessages() {
        if (confirm('Hapus semua pesan? Tindakan ini tidak dapat dibatalkan.')) {
            socket.emit('clear_messages');
        }
    }
    
    function handleResize() {
        scrollToBottom();
        closeContextMenu(); // Close context menu on resize
    }
    
    function scrollToBottom() {
        setTimeout(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 50);
    }
    
    // Event listeners untuk socket events tambahan
    function setupAdditionalSocketEvents() {
        // Message deleted event
        socket.on('message_deleted', function(data) {
            const messageEl = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (messageEl) {
                // Add deleted message styling
                messageEl.classList.add('deleted');
                const contentEl = messageEl.querySelector('.message-content');
                contentEl.innerHTML = '<i class="fas fa-ban"></i> Pesan ini telah dihapus';
                
                // Remove from messages data
                delete messagesData[data.messageId];
            }
        });
        
        // Connection status events
        socket.on('connect', function() {
            console.log('Connected to server');
            document.body.classList.remove('disconnected');
        });
        
        socket.on('disconnect', function() {
            console.log('Disconnected from server');
            document.body.classList.add('disconnected');
            showToast('Koneksi terputus. Mencoba menghubungkan kembali...');
        });
        
        socket.on('reconnect', function() {
            console.log('Reconnected to server');
            document.body.classList.remove('disconnected');
            showToast('Terhubung kembali!');
        });
        
        // Error handling
        socket.on('error', function(error) {
            console.error('Socket error:', error);
            showToast('Terjadi kesalahan. Silakan refresh halaman.');
        });
    }
    
    // Utility functions
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    function throttle(func, limit) {
        let inThrottle;
        return function() {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }
    
    // Keyboard shortcuts
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', function(e) {
            // ESC to cancel reply
            if (e.key === 'Escape' && replyingTo) {
                cancelReply();
            }
            
            // Ctrl+K to clear messages (for authorized users)
            if (e.ctrlKey && e.key === 'k' && authorizedUsers.includes(currentUser)) {
                e.preventDefault();
                confirmClearMessages();
            }
            
            // Alt+R to reply to last message
            if (e.altKey && e.key === 'r') {
                e.preventDefault();
                const lastMessage = Object.values(messagesData).slice(-1)[0];
                if (lastMessage && lastMessage.username !== currentUser) {
                    startReply(lastMessage);
                }
            }
        });
    }
    
    // Message search functionality
    function setupMessageSearch() {
        const searchInput = document.getElementById('search-input');
        if (!searchInput) return;
        
        const searchMessages = debounce(function(query) {
            const messages = document.querySelectorAll('.message');
            messages.forEach(messageEl => {
                const messageId = messageEl.getAttribute('data-message-id');
                const message = messagesData[messageId];
                
                if (message && message.text && message.text.toLowerCase().includes(query.toLowerCase())) {
                    messageEl.classList.add('search-match');
                } else {
                    messageEl.classList.remove('search-match');
                }
            });
        }, 300);
        
        searchInput.addEventListener('input', function() {
            const query = this.value.trim();
            if (query.length > 2) {
                searchMessages(query);
            } else {
                // Clear search highlights
                document.querySelectorAll('.message').forEach(el => {
                    el.classList.remove('search-match');
                });
            }
        });
    }
    
    // Emoji picker functionality
    function setupEmojiPicker() {
        const emojiBtn = document.getElementById('emoji-btn');
        const emojiPicker = document.getElementById('emoji-picker');
        
        if (!emojiBtn || !emojiPicker) return;
        
        const emojis = ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦿', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟'];
        
        // Create emoji grid
        emojis.forEach(emoji => {
            const emojiSpan = document.createElement('span');
            emojiSpan.textContent = emoji;
            emojiSpan.className = 'emoji-item';
            emojiSpan.addEventListener('click', () => {
                messageInput.value += emoji;
                messageInput.dispatchEvent(new Event('input'));
                emojiPicker.classList.add('hidden');
                messageInput.focus();
            });
            emojiPicker.appendChild(emojiSpan);
        });
        
        emojiBtn.addEventListener('click', () => {
            emojiPicker.classList.toggle('hidden');
        });
        
        // Close emoji picker when clicking outside
        document.addEventListener('click', (e) => {
            if (!emojiBtn.contains(e.target) && !emojiPicker.contains(e.target)) {
                emojiPicker.classList.add('hidden');
            }
        });
    }
    
    // Initialize additional features after join
    function initializeAdditionalFeatures() {
        setupAdditionalSocketEvents();
        setupKeyboardShortcuts();
        setupMessageSearch();
        setupEmojiPicker();
    }
    
    // Update time ago setiap menit
    setInterval(() => {
        if (!lastSeen.classList.contains('hidden') && statusDot.classList.contains('offline')) {
            const otherUsername_val = otherUsername.textContent;
            if (allUserLastSeen[otherUsername_val]) {
                const timeAgo = getTimeAgo(allUserLastSeen[otherUsername_val]);
                lastSeen.textContent = `Terakhir dilihat ${timeAgo}`;
            }
        }
    }, 60000); // Update setiap menit
    
    // Performance optimization: Virtual scrolling for large message lists
    function setupVirtualScrolling() {
        if (Object.keys(messagesData).length > 1000) {
            // Implement virtual scrolling for performance
            console.log('Virtual scrolling activated for large message count');
            // Implementation would go here for very large chat histories
        }
    }
    
    // Message status indicator
    function updateConnectionStatus() {
        const statusIndicator = document.getElementById('connection-status');
        if (statusIndicator) {
            if (socket && socket.connected) {
                statusIndicator.textContent = 'Terhubung';
                statusIndicator.className = 'connection-status online';
            } else {
                statusIndicator.textContent = 'Memuat...';
                statusIndicator.className = 'connection-status offline';
            }
        }
    }
    
    // Call additional initialization
    setTimeout(() => {
        initializeAdditionalFeatures();
        updateConnectionStatus();
    }, 1000);
    
    // Update connection status periodically
    setInterval(updateConnectionStatus, 5000);
});
