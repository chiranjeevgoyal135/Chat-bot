import sqlite3
import os

DB_NAME = 'gemini_chat.db'

def create_db_tables():
    """Creates the necessary SQLite tables for group sessions and chats."""
    try:
        conn = sqlite3.connect(DB_NAME)
        cursor = conn.cursor()

        # Table for group sessions identified by passcode
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS group_sessions (
                session_id INTEGER PRIMARY KEY AUTOINCREMENT,
                passcode TEXT NOT NULL UNIQUE,
                group_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        ''')

        # Table for storing individual chats within group sessions
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chats (
                chat_id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                title TEXT NOT NULL DEFAULT 'New Chat',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (session_id) REFERENCES group_sessions(session_id)
            );
        ''')

        # Table for storing messages within chats
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                message_id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER,
                sender TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
            );
        ''')

        conn.commit()
        print(f"Database '{DB_NAME}' and tables created successfully.")

    except sqlite3.Error as e:
        print(f"An error occurred: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    create_db_tables()