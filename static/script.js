// Global state variables
let currentSessionId = null;
let currentChatId = null;
let currentGroupName = '';
let currentPasscode = '';
const messageArea = document.getElementById('message-area');
const chatHistoryList = document.getElementById('chat-history');
const userInput = document.getElementById('user-input');
const sendButton = document.getElementById('send-btn');
const newChatButton = document.getElementById('new-chat-btn');
const headerNewChatButton = document.getElementById('header-new-chat-btn');
const currentChatTitle = document.getElementById('current-chat-title');
const sidebarToggleButton = document.getElementById('sidebar-toggle-btn');
const appContainer = document.getElementById('app-container');
const headerAppName = document.getElementById('header-app-name');

// Login variables
const loginModal = document.getElementById('login-modal');
const passcodeInput = document.getElementById('passcode-input');
const joinSessionBtn = document.getElementById('join-session-btn');
const loginError = document.getElementById('login-error');

// Real-time polling variables
let lastMessageCheck = 0;
let lastChatCheck = 0;
let pollingInterval = null;
let chatPollingInterval = null;

// --- Multimodal State Variables ---
const fileInput = document.getElementById('file-input');
const uploadBtn = document.getElementById('upload-btn');
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const clearImageBtn = document.getElementById('clear-image-btn');

let imageBase64Data = null;
let imageMimeType = null;

// --- Multimodal Helper Functions ---
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

function clearImage() {
    imageBase64Data = null;
    imageMimeType = null;
    fileInput.value = '';
    imagePreview.src = '#';
    imagePreviewContainer.classList.add('hidden');
}

function copyToClipboard(btnElement, textToCopy) {
    if (!textToCopy) return;

    const tempInput = document.createElement('textarea');
    tempInput.value = textToCopy;
    document.body.appendChild(tempInput);
    tempInput.select();

    try {
        document.execCommand('copy');
        
        const originalText = btnElement.textContent;
        const successMessage = btnElement.classList.contains('copy-btn') ? 'Copied!' : 'Copied Response!';
        
        btnElement.textContent = successMessage;
        btnElement.disabled = true;

        setTimeout(() => {
            btnElement.textContent = originalText;
            btnElement.disabled = false;
        }, 1500);

    } catch (err) {
        console.error('Failed to copy text: ', err);
    }
    
    document.body.removeChild(tempInput);
}

// --- Real-time Polling Functions ---
function startPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
    
    pollingInterval = setInterval(async () => {
        if (currentChatId) {
            try {
                const response = await fetch(`/check_new_messages/${currentChatId}?last_check=${lastMessageCheck}`);
                const data = await response.json();
                
                if (data.has_new_messages && data.new_messages && data.new_messages.length > 0) {
                    console.log(`Found ${data.new_messages.length} new messages from other users`);
                    
                    // Only add messages that are truly new (not our own)
                    let addedMessages = 0;
                    data.new_messages.forEach(msg => {
                        // Only add if this message is newer than our last check
                        // This prevents duplicates from our own messages
                        if (msg.timestamp > lastMessageCheck) {
                            displayMessage(msg.sender, msg.text);
                            addedMessages++;
                        }
                    });
                    
                    if (addedMessages > 0) {
                        console.log(`Added ${addedMessages} new messages from other users`);
                        lastMessageCheck = data.current_time;
                        messageArea.scrollTop = messageArea.scrollHeight;
                    }
                }
            } catch (error) {
                console.error('Error checking for new messages:', error);
            }
        }
    }, 2000); // Check every 2 seconds
}

function startChatPolling() {
    if (chatPollingInterval) {
        clearInterval(chatPollingInterval);
    }
    
    chatPollingInterval = setInterval(async () => {
        if (currentSessionId) {
            try {
                const response = await fetch(`/check_new_chats/${currentSessionId}?last_check=${lastChatCheck}`);
                const data = await response.json();
                
                if (data.has_new_chats) {
                    console.log('New chat detected, reloading chat list');
                    await loadChatHistory();
                    lastChatCheck = data.current_time;
                }
            } catch (error) {
                console.error('Error checking for new chats:', error);
            }
        }
    }, 3000); // Check for new chats every 3 seconds
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

function stopChatPolling() {
    if (chatPollingInterval) {
        clearInterval(chatPollingInterval);
        chatPollingInterval = null;
    }
}

function stopAllPolling() {
    stopPolling();
    stopChatPolling();
}

// --- Delete Chat Function ---
async function deleteChat(chat_id) {
    if (!confirm("Are you sure you want to delete this chat? This action cannot be undone.")) {
        return;
    }
    
    try {
        const response = await fetch(`/delete_chat/${chat_id}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });

        const data = await response.json();
        
        if (response.ok && data.success) {
            // If we're currently viewing the deleted chat, clear the message area
            if (currentChatId === chat_id) {
                messageArea.innerHTML = '';
                currentChatTitle.textContent = 'Select a Chat';
                sendButton.disabled = true;
                
                // Try to load another chat or show empty state
                const response = await fetch(`/get_chats/${currentSessionId}`);
                const chats = await response.json();
                
                if (chats.length > 0) {
                    // Load the most recent chat
                    await loadMessages(chats[0].chat_id);
                } else {
                    // No chats left, show empty state
                    displayMessage('gemini', 'No chats available. Create a new chat to start conversation.', 'no-chats-message');
                }
            }
            
            // Reload the chat history to reflect the deletion
            await loadChatHistory();
            
        } else {
            alert(`Failed to delete chat: ${data.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error deleting chat:', error);
        alert('Network error while trying to delete chat.');
    }
}

// --- Core Chat Functions ---
async function joinSession(passcode) {
    try {
        const response = await fetch('/join_session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ passcode: passcode })
        });

        const data = await response.json();
        
        if (response.ok) {
            currentSessionId = data.session_id;
            currentChatId = data.chat_id;
            currentGroupName = data.group_name;
            currentPasscode = passcode;
            
            // Hide login modal, show app
            loginModal.style.display = 'none';
            appContainer.style.display = 'flex';
            
            await loadMessages(currentChatId);
            await loadChatHistory();
            
            // Initialize polling times
            lastChatCheck = Math.floor(Date.now() / 1000);
            
            // Start both polling systems
            startPolling();
            startChatPolling();
            
            await loadSessionInfo(currentSessionId);
            
        } else {
            loginError.textContent = data.error || 'Failed to join session';
            loginError.style.display = 'block';
        }
    } catch (error) {
        console.error('Error joining session:', error);
        loginError.textContent = 'Network error. Please try again.';
        loginError.style.display = 'block';
    }
}

async function startNewChatInSession() {
    if (!currentSessionId) {
        console.error('No current session available');
        return;
    }
    
    try {
        const response = await fetch('/new_chat_in_session', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ session_id: currentSessionId })
        });

        const data = await response.json();
        
        if (response.ok) {
            // Stop polling for old chat
            stopAllPolling();
            
            // Switch to new chat
            currentChatId = data.chat_id;
            
            // Clear current messages and load new chat
            messageArea.innerHTML = '';
            await loadMessages(currentChatId);
            await loadChatHistory(); // Reload sidebar to show new chat
            
            // Update chat check time to now so other users detect the new chat
            lastChatCheck = Math.floor(Date.now() / 1000);
            
            // Restart polling
            startPolling();
            startChatPolling();
            
        } else {
            alert('Failed to start new chat: ' + data.error);
        }
    } catch (error) {
        console.error('Error starting new chat:', error);
        alert('Network error starting new chat');
    }
}

async function loadChatHistory() {
    if (!currentSessionId) return;
    
    try {
        const response = await fetch(`/get_chats/${currentSessionId}`);
        const chats = await response.json();
        
        chatHistoryList.innerHTML = '';
        
        // Add group info header
        const groupInfo = document.createElement('div');
        groupInfo.style.cssText = 'color: #e5e7eb; padding: 15px; background: #374151; border-radius: 8px; margin-bottom: 10px;';
        groupInfo.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 5px;">${currentGroupName}</div>
            <div style="font-size: 0.8em; color: #9ca3af;">Passcode: ${currentPasscode}</div>
            <div style="font-size: 0.7em; color: #6b7280; margin-top: 8px;">
                💡 Real-time chat - messages and chats sync automatically
            </div>
        `;
        chatHistoryList.appendChild(groupInfo);

        if (chats.length === 0) {
            const noChats = document.createElement('div');
            noChats.style.cssText = 'color: #9ca3af; text-align: center; padding: 20px; font-size: 0.9em;';
            noChats.textContent = 'No chats yet';
            chatHistoryList.appendChild(noChats);
        } else {
            chats.forEach(chat => {
                const chatItem = document.createElement('div');
                chatItem.classList.add('chat-item');
                chatItem.setAttribute('data-chat-id', chat.chat_id);
                
                if (chat.chat_id == currentChatId) {
                    chatItem.classList.add('active');
                }

                let date, formattedTime, formattedDate;
                if (chat.timestamp && chat.timestamp > 0) {
                    date = new Date(chat.timestamp * 1000);
                    formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    formattedDate = date.toLocaleDateString();
                } else {
                    formattedTime = 'N/A';
                    formattedDate = 'N/A';
                }
                
                chatItem.innerHTML = `
                    <span class="chat-title-text">${chat.title}</span>
                    <span class="chat-item-tooltip">
                        <div class="tooltip-title">${chat.title}</div>
                        <div>Created: ${formattedDate} at ${formattedTime}</div>
                    </span>
                    <span class="delete-btn" data-chat-id="${chat.chat_id}" title="Delete Chat">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                            <path fill-rule="evenodd" d="M16.5 4.475C16.5 3.391 17.391 2.5 18.475 2.5h1.05C20.609 2.5 21.5 3.391 21.5 4.475v1.05c0 1.084-.891 1.975-1.975 1.975h-1.05c-1.084 0-1.975-.891-1.975-1.975v-1.05zM17.5 19.5V8.5h3.0v11.0h-3.0zM6.5 8.5v11.0c0 1.105.895 2.0 2.0 2.0h7.0c1.105 0 2.0-.895 2.0-2.0V8.5h-11.0zM14.5 4.5h-5.0c-1.105 0-2.0.895-2.0 2.0v.5h9.0v-.5c0-1.105-.895-2.0-2.0-2.0z"/>
                        </svg>
                    </span>
                `;

                // Click to load chat
                chatItem.addEventListener('click', (e) => {
                    if (!e.target.closest('.delete-btn')) {
                        loadMessages(chat.chat_id);
                    }
                });

                // Delete button click
                const deleteBtn = chatItem.querySelector('.delete-btn');
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteChat(chat.chat_id);
                });

                chatHistoryList.appendChild(chatItem);
            });
        }

    } catch (error) {
        console.error('Error loading chat history:', error);
        chatHistoryList.innerHTML = '<div style="color: #ef4444; padding: 10px;">Error loading chats</div>';
    }
}

async function loadSessionInfo(sessionId) {
    try {
        const response = await fetch(`/get_session_info/${sessionId}`);
        const data = await response.json();
        
        if (response.ok) {
            currentGroupName = data.group_name;
            document.getElementById('current-chat-title').textContent = 'New Chat';
            document.getElementById('header-app-name').textContent = `🤖 ${currentGroupName}`;
            
            let passcodeDisplay = document.getElementById('passcode-display');
            if (!passcodeDisplay) {
                passcodeDisplay = document.createElement('span');
                passcodeDisplay.id = 'passcode-display';
                passcodeDisplay.style.cssText = 'font-size: 0.8em; color: #9ca3af; margin-left: 10px; background: rgba(79, 70, 229, 0.2); padding: 2px 8px; border-radius: 10px; border: 1px solid #4f46e5;';
                document.getElementById('chat-header').appendChild(passcodeDisplay);
            }
            passcodeDisplay.textContent = `Passcode: ${data.passcode}`;
        }
    } catch (error) {
        console.error('Error loading session info:', error);
    }
}

async function loadMessages(chat_id) {
    if (currentChatId == chat_id && messageArea.children.length > 0) {
        return; // Don't reload if we're already viewing this chat
    }
    
    // Stop polling for old chat
    stopAllPolling();
    
    currentChatId = chat_id;
    messageArea.innerHTML = '';
    sendButton.disabled = true;
    
    // Update active chat in sidebar
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });

    try {
        const response = await fetch(`/get_messages/${chat_id}`);
        const data = await response.json();

        currentChatTitle.textContent = data.title;

        if (data.messages.length === 0) {
            displayMessage('gemini', `Welcome to "${currentGroupName}"! This is a shared group chat. Everyone with passcode "${currentPasscode}" can see and contribute to this conversation. Start by saying hello!`, 'welcome-message');
            lastMessageCheck = Math.floor(Date.now() / 1000);
        } else {
            data.messages.forEach(msg => {
                displayMessage(msg.sender, msg.text);
            });
            // Set lastMessageCheck to the latest message timestamp
            lastMessageCheck = data.messages[data.messages.length - 1].timestamp;
        }
        
        // Update sidebar to highlight active chat
        await loadChatHistory();
        
    } catch (error) {
        console.error('Error loading messages:', error);
        displayMessage('gemini', 'Error loading chat messages.', 'error-message');
    } finally {
        sendButton.disabled = false;
        userInput.focus();
        startPolling(); // Start polling for new chat
        startChatPolling(); // Start chat list polling
    }
}

function displayMessage(sender, text, id = null, imageUrl = null) {
    const messageWrapper = document.createElement('div');
    messageWrapper.classList.add('message-wrapper', `${sender}-wrapper`);
    
    const profileIcon = document.createElement('div');
    profileIcon.classList.add('profile-icon', `${sender}-icon`);
    profileIcon.textContent = sender === 'user' ? 'U' : 'AI';

    const message = document.createElement('div');
    message.classList.add('message', `${sender}-message`);

    if (sender === 'gemini') {
        message.classList.add('chat-bubble-content');
        
        let finalText = text;
        
        if (id !== 'loading-indicator') {
            const rawHtml = marked.parse(text);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = rawHtml;

            tempDiv.querySelectorAll('pre').forEach(pre => {
                const codeContent = pre.textContent;
                const copyBtn = document.createElement('button');
                copyBtn.textContent = 'Copy Code';
                copyBtn.classList.add('copy-btn');
                
                copyBtn.addEventListener('click', () => {
                    copyToClipboard(copyBtn, codeContent);
                });

                pre.insertBefore(copyBtn, pre.firstChild);
            });

            message.innerHTML = tempDiv.innerHTML;
        } else {
            message.innerHTML = `
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            `;
        }

        if (id !== 'loading-indicator') {
             const copyResponseBtn = document.createElement('button');
             copyResponseBtn.classList.add('response-copy-btn');
             copyResponseBtn.setAttribute('title', 'Copy full response');
             copyResponseBtn.innerHTML = `
                 <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                     <path d="M7.5 7.5a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H7.5zM7.5 11.25a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H7.5zM7.5 15a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H7.5zM3.465 19.5h14.57c.5 0 .964-.202 1.306-.554a2.128 2.128 0 0 0 .584-1.423 5.485 5.485 0 0 0-.256-2.585 5.25 5.25 0 0 0-.825-1.517 5.25 5.25 0 0 0-1.517-.825 5.485 5.485 0 0 0-2.585-.256 5.25 5.25 0 0 0-1.423-.584 2.128 2.128 0 0 0-.554-1.306H5.25a2.25 2.25 0 0 0-2.25 2.25v10.5c0 1.242 1.008 2.25 2.25 2.25zm.5-12a.75.75 0 0 0 .75-.75h14.5a.75.75 0 0 0 0-1.5H4.25a.75.75 0 0 0-.75.75V15h2.25a.75.75 0 0 0 .75-.75V8.25z"/>
                 </svg>
             `;
             copyResponseBtn.addEventListener('click', () => {
                 copyToClipboard(copyResponseBtn, text);
             });
             messageWrapper.appendChild(copyResponseBtn);
        }
        
    } else {
        let contentHtml = '';
        
        if (imageUrl && imageUrl !== '#') {
            contentHtml += `<img src="${imageUrl}" class="chat-sent-image">`;
        }

        if (text && text.trim().length > 0) {
            contentHtml += `<p>${text.replace(/\n/g, '<br>')}</p>`;
        } else if (imageUrl && imageUrl !== '#') {
             contentHtml += `<p class="image-only-note">Image sent.</p>`;
        }

        message.innerHTML = contentHtml;
    }

    if (id) {
        messageWrapper.id = id;
    }

    messageWrapper.appendChild(profileIcon);
    messageWrapper.appendChild(message);

    messageArea.appendChild(messageWrapper);
    messageArea.scrollTop = messageArea.scrollHeight;
}

async function sendMessage() {
    const messageText = userInput.value.trim();
    const currentImageBase64Url = imagePreview.src;
    
    if (!messageText && !imageBase64Data) return;
    if (currentChatId === null || sendButton.disabled) return;

    // Store current timestamp before sending
    const beforeSendTime = Math.floor(Date.now() / 1000);
    
    // Display user message immediately
    displayMessage('user', messageText, null, currentImageBase64Url);
    
    userInput.value = '';
    userInput.style.height = '40px';
    sendButton.disabled = true;

    const payload = {
        chat_id: currentChatId,
        message: messageText,
        image_data: imageBase64Data,
        mime_type: imageMimeType
    };

    // Display loading indicator
    displayMessage('gemini', 'loading', 'loading-indicator');
    clearImage();

    const safetyTimeout = setTimeout(() => {
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) {
            messageArea.removeChild(loadingIndicator);
            displayMessage('gemini', 'Timed out waiting for response.', null);
        }
        sendButton.disabled = false;
        userInput.focus();
    }, 25000);

    try {
        const response = await fetch('/send_message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        clearTimeout(safetyTimeout);

        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) messageArea.removeChild(loadingIndicator);

        if (data.error) {
            displayMessage('gemini', `[ERROR]: ${data.error}`);
        } else {
            // Display AI response immediately
            displayMessage('gemini', data.response);
            
            // Update last check time to AFTER our sent message
            // This prevents polling from picking up our own messages
            lastMessageCheck = Math.floor(Date.now() / 1000);
            
            // Update chat history for title changes
            await loadChatHistory();
        }

    } catch (error) {
        console.error('Error sending message:', error);
        clearTimeout(safetyTimeout);
        const loadingIndicator = document.getElementById('loading-indicator');
        if (loadingIndicator) messageArea.removeChild(loadingIndicator);
        displayMessage('gemini', 'Network error. Check your connection.');
    } finally {
        sendButton.disabled = false;
        userInput.focus();
    }
}

// --- Event Listeners ---

// 1. Sidebar Toggle Button
sidebarToggleButton.addEventListener('click', () => {
    appContainer.classList.toggle('sidebar-closed');
    if (window.innerWidth <= 768) {
        appContainer.classList.toggle('sidebar-open-mobile');
    }
});

// 2. New Chat Button - Creates new chat in same group
newChatButton.addEventListener('click', startNewChatInSession);
headerNewChatButton.addEventListener('click', startNewChatInSession);

// 3. Send Button
sendButton.addEventListener('click', sendMessage);

// 4. Enter Key for sending message
userInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
    userInput.style.height = 'auto';
    userInput.style.height = userInput.scrollHeight + 'px';
});

// 5. Login functionality
joinSessionBtn.addEventListener('click', () => {
    const passcode = passcodeInput.value.trim();
    if (passcode) {
        joinSession(passcode);
    } else {
        loginError.textContent = 'Please enter a passcode';
        loginError.style.display = 'block';
    }
});

passcodeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const passcode = passcodeInput.value.trim();
        if (passcode) {
            joinSession(passcode);
        }
    }
});

// 6. Multimodal Listeners
uploadBtn.addEventListener('click', () => fileInput.click());
clearImageBtn.addEventListener('click', clearImage);

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file.');
            return;
        }
        
        imageMimeType = file.type;

        const reader = new FileReader();
        reader.onload = (event) => {
            imagePreview.src = event.target.result;
            imagePreviewContainer.classList.remove('hidden');
        };
        reader.readAsDataURL(file);

        const base64Url = await fileToBase64(file);
        imageBase64Data = base64Url.split(',')[1];
    } else {
        clearImage();
    }
});

// 7. Stop polling when page is hidden
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        stopAllPolling();
    } else {
        if (currentChatId && !pollingInterval) {
            startPolling();
        }
        if (currentSessionId && !chatPollingInterval) {
            startChatPolling();
        }
    }
});

// 8. Initial Load - Show login modal
document.addEventListener('DOMContentLoaded', () => {
    loginModal.style.display = 'flex';
    appContainer.style.display = 'none';
    passcodeInput.focus();
});