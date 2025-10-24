import os
import sqlite3
import json
import base64
import time
from flask import Flask, render_template, request, jsonify, g
from google import genai
from google.genai import types


# --- Configuration ---

app = Flask(__name__)
DB_NAME = 'gemini_chat.db'
MODEL_NAME = 'gemini-2.5-flash'

# --- PREDEFINED PASSCODES - ONLY THESE WILL WORK ---
# Add your group passcodes here in this format:
# "PASSCODE": "Group Name"
PREDEFINED_PASSCODES = {
    "ai1": "TEAM ONE",
    "ai2": "TEAM TWO", 
    "ai3": "TEAM THREE",
    "ai4": "TEAM FOUR",
    "ai5": "TEAM FIVE",
    "ai6": "TEAM SIX",
    "ai7": "TEAM SEVEN",
    "ai8": "TEAM EIGHT",
    "ai9": "TEAM NINE",
    "ai10": "TEAM TEN"
    # ADD MORE PASSCODES HERE:
    # "YOUR_PASSCODE": "Your Group Name",
}

client = None

# --- Database Helper Functions ---
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DB_NAME)
        db.row_factory = sqlite3.Row
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    """Initialize database tables if they don't exist"""
    db = get_db()
    cursor = db.cursor()
    
    # Create tables if they don't exist
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS group_sessions (
            session_id INTEGER PRIMARY KEY AUTOINCREMENT,
            passcode TEXT NOT NULL UNIQUE,
            group_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chats (
            chat_id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            title TEXT NOT NULL DEFAULT 'New Chat',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES group_sessions(session_id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            message_id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER,
            sender TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
        )
    ''')
    
    db.commit()
    print("Database initialized successfully")

# --- Group Session Logic ---
def get_or_create_session(passcode):
    """Get existing session or create new one for predefined passcodes only."""
    db = get_db()
    cursor = db.cursor()
    
    # Check if passcode is valid
    if passcode not in PREDEFINED_PASSCODES:
        raise ValueError("Invalid passcode")
    
    group_name = PREDEFINED_PASSCODES[passcode]
    
    # Try to find existing session
    cursor.execute("SELECT session_id FROM group_sessions WHERE passcode = ?", (passcode,))
    session = cursor.fetchone()
    
    if session:
        return session['session_id'], group_name
    else:
        # Create new session for this predefined passcode
        cursor.execute("INSERT INTO group_sessions (passcode, group_name) VALUES (?, ?)", (passcode, group_name))
        db.commit()
        return cursor.lastrowid, group_name

def create_new_chat_in_session(session_id):
    """Create a new chat within an existing session."""
    db = get_db()
    cursor = db.cursor()
    
    try:
        timestamp = int(time.time())
        cursor.execute("INSERT INTO chats (session_id, title, timestamp) VALUES (?, ?, ?)", 
                      (session_id, 'New Chat', timestamp))
        db.commit()
        return cursor.lastrowid
    except sqlite3.Error as e:
        print(f"Database error creating new chat: {e}")
        raise e

# --- Gemini Client Initialization ---
try:
    client = genai.Client()
    print("Gemini client initialized successfully.")
except Exception as e:
    print(f"FATAL ERROR: Failed to initialize Gemini client. Check GEMINI_API_KEY. Details: {e}")
    client = None

# --- API Endpoints ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/join_session', methods=['POST'])
def join_session():
    """Joins a group session using predefined passcodes only."""
    # Initialize database first
    init_db()
    
    data = request.json
    passcode = data.get('passcode', '').strip()
    
    if not passcode:
        return jsonify({'error': 'Passcode cannot be empty'}), 400
    
    try:
        session_id, group_name = get_or_create_session(passcode)
        
        # Get or create the first chat in this session
        db = get_db()
        cursor = db.cursor()
        cursor.execute("SELECT chat_id FROM chats WHERE session_id = ? ORDER BY timestamp DESC LIMIT 1", (session_id,))
        chat = cursor.fetchone()
        
        if chat:
            chat_id = chat['chat_id']
        else:
            # Create first chat for this session
            chat_id = create_new_chat_in_session(session_id)
        
        return jsonify({
            'session_id': session_id, 
            'chat_id': chat_id,
            'group_name': group_name,
            'message': f'Joined {group_name} successfully'
        }), 200
    except ValueError:
        return jsonify({'error': 'Invalid passcode. Please use a valid group passcode.'}), 400
    except Exception as e:
        print(f"Error joining session: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Database error: {str(e)}'}), 500

@app.route('/new_chat_in_session', methods=['POST'])
def new_chat_in_session():
    """Creates a new chat within the same session."""
    data = request.json
    session_id = data.get('session_id')
    
    if not session_id:
        return jsonify({'error': 'Session ID required'}), 400
    
    try:
        chat_id = create_new_chat_in_session(session_id)
        
        # Get group name for response
        cursor = get_db().cursor()
        cursor.execute("SELECT group_name FROM group_sessions WHERE session_id = ?", (session_id,))
        session = cursor.fetchone()
        group_name = session['group_name'] if session else "Group"
        
        return jsonify({
            'chat_id': chat_id,
            'session_id': session_id,
            'group_name': group_name,
            'message': f'New chat created in {group_name}'
        }), 200
    except Exception as e:
        print(f"Error creating new chat: {e}")
        return jsonify({'error': 'Failed to create new chat'}), 500

@app.route('/get_chats/<int:session_id>', methods=['GET'])
def get_chats(session_id):
    """Gets all chats for a session."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute(
            "SELECT chat_id, title, timestamp FROM chats WHERE session_id = ? ORDER BY timestamp DESC",
            (session_id,)
        )
        chats = cursor.fetchall()
        chat_list = [dict(chat) for chat in chats]
        return jsonify(chat_list)
    except sqlite3.Error as e:
        print(f"Database error fetching chats: {e}")
        return jsonify([]), 500

@app.route('/get_messages/<int:chat_id>', methods=['GET'])
def get_messages(chat_id):
    """Fetches all messages for a specific chat."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute(
            "SELECT sender, text, timestamp FROM messages WHERE chat_id = ? ORDER BY timestamp ASC",
            (chat_id,)
        )
        messages = cursor.fetchall()
        message_list = [dict(msg) for msg in messages]

        cursor.execute("SELECT title FROM chats WHERE chat_id = ?", (chat_id,))
        chat_title = cursor.fetchone()['title'] if cursor.rowcount > 0 else 'New Chat'
        
        return jsonify({'messages': message_list, 'title': chat_title})
    except sqlite3.Error as e:
        print(f"Database error fetching messages for chat {chat_id}: {e}")
        return jsonify({'messages': [], 'title': 'Error Loading Chat'}), 500

@app.route('/check_new_messages/<int:chat_id>', methods=['GET'])
def check_new_messages(chat_id):
    """Real-time endpoint: checks if there are new messages since last check."""
    db = get_db()
    cursor = db.cursor()
    try:
        last_check = request.args.get('last_check', 0, type=int)
        
        # Get the count of new messages and also the new messages themselves
        cursor.execute(
            "SELECT COUNT(*) as new_count, MAX(timestamp) as current_time FROM messages WHERE chat_id = ? AND timestamp > ?",
            (chat_id, last_check)
        )
        result = cursor.fetchone()
        
        # Also get the actual new messages to return
        cursor.execute(
            "SELECT sender, text, timestamp FROM messages WHERE chat_id = ? AND timestamp > ? ORDER BY timestamp ASC",
            (chat_id, last_check)
        )
        new_messages = cursor.fetchall()
        new_message_list = [dict(msg) for msg in new_messages]
        
        current_time = result['current_time'] or last_check
        
        return jsonify({
            'has_new_messages': result['new_count'] > 0,
            'current_time': current_time,
            'new_messages': new_message_list
        })
    except sqlite3.Error as e:
        print(f"Database error checking new messages: {e}")
        return jsonify({'has_new_messages': False, 'current_time': last_check, 'new_messages': []})
    
@app.route('/get_session_info/<int:session_id>', methods=['GET'])
def get_session_info(session_id):
    """Gets group name and basic session info."""
    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute(
            "SELECT group_name, passcode FROM group_sessions WHERE session_id = ?",
            (session_id,)
        )
        session = cursor.fetchone()
        
        if session:
            return jsonify({
                'group_name': session['group_name'],
                'passcode': session['passcode']
            })
        else:
            return jsonify({'error': 'Session not found'}), 404
    except sqlite3.Error as e:
        print(f"Database error getting session info: {e}")
        return jsonify({'error': 'Database error'}), 500


@app.route('/send_message', methods=['POST'])
def send_message():
    """
    Handles user message for group sessions.
    """
    if client is None:
        return jsonify({'error': 'AI client not initialized. Check your GEMINI_API_KEY.'}), 500
        
    data = request.json
    chat_id = data.get('chat_id')
    user_message = data.get('message')
    image_data = data.get('image_data')
    mime_type = data.get('mime_type')

    if not user_message and not image_data:
        return jsonify({'error': 'Message cannot be empty'}), 400

    db = get_db()
    cursor = db.cursor()

    # 1. Retrieve Conversation History from DB for this chat
    cursor.execute(
        "SELECT sender, text FROM messages WHERE chat_id = ? ORDER BY message_id ASC",
        (chat_id,)
    )
    history_rows = cursor.fetchall()
    
    # 2. Format History for Chat Service
    history_contents = []
    for row in history_rows:
        role = 'user' if row['sender'] == 'user' else 'model'
        clean_text = row['text'].strip()
        text_part = types.Part(text=clean_text)
        
        history_contents.append(
            types.Content(
                role=role, 
                parts=[text_part]
            )
        )

    # 3. Construct Multimodal Message Parts
    user_message_parts = []
    
    if image_data and mime_type:
        try:
            image_bytes = base64.b64decode(image_data)
            image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            user_message_parts.append(image_part)
        except Exception as e:
            print(f"Error decoding image data: {e}")
            return jsonify({'error': 'Invalid image data received.'}), 400

    if user_message:
        text_part = types.Part(text=user_message)
        user_message_parts.append(text_part)

    # 4. Initialize Chat Session with Full History
    try:
        print("Attempting to create Gemini chat session...")
        chat = client.chats.create(
            model=MODEL_NAME,
            history=history_contents
        )
        
        print("Sending message to Gemini...")
        response = chat.send_message(user_message_parts)
        gemini_response_text = response.text
        print("Successfully received response from Gemini")
        
    except Exception as e:
        print(f"Gemini API Error: {e}")
        print(f"Error type: {type(e)}")
        import traceback
        print(f"Full traceback: {traceback.format_exc()}")
        
        # More specific error messages
        if "API_KEY" in str(e) or "key" in str(e).lower():
            return jsonify({'error': 'Invalid Gemini API key. Please check your GEMINI_API_KEY in .env file.'}), 500
        elif "quota" in str(e).lower():
            return jsonify({'error': 'Gemini API quota exceeded. Please check your usage limits.'}), 500
        elif "429" in str(e):
            return jsonify({'error': 'Rate limit exceeded. Please wait a moment and try again.'}), 500
        else:
            return jsonify({'error': f'Failed to communicate with AI: {str(e)}'}), 500

    # 5. Save User Message to DB
    try:
        timestamp = int(time.time())
        sanitized_user_message = user_message.strip() if user_message else "[Image Sent]"
        cursor.execute(
            "INSERT INTO messages (chat_id, sender, text, timestamp) VALUES (?, ?, ?, ?)",
            (chat_id, 'user', sanitized_user_message, timestamp)
        )

        # 6. Save Gemini Response to DB
        sanitized_response = gemini_response_text.strip()
        cursor.execute(
            "INSERT INTO messages (chat_id, sender, text, timestamp) VALUES (?, ?, ?, ?)",
            (chat_id, 'gemini', sanitized_response, int(time.time()))
        )

        # 7. Auto-Generate Title if it's the first message
        if len(history_rows) == 0:
            title_text = user_message if user_message else "Image Query"
            title = ' '.join(title_text.split()[:5]).replace('\n', ' ') + '...'
            cursor.execute("UPDATE chats SET title = ?, timestamp = ? WHERE chat_id = ?", 
                          (title, int(time.time()), chat_id))
        else:
            # Update the chat timestamp on new activity
            cursor.execute("UPDATE chats SET timestamp = ? WHERE chat_id = ?", 
                          (int(time.time()), chat_id))

        db.commit()
    except sqlite3.Error as e:
        print(f"Database error saving messages: {e}")
        return jsonify({'error': 'AI response received but failed to save to database.'}), 500

    return jsonify({'response': gemini_response_text})

if __name__ == '__main__':
    # Initialize database on startup
    with app.app_context():
        init_db()
    app.run(debug=True)