"""
Database module for Coach conversation persistence
"""
import sqlite3
import json
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from pathlib import Path
import os

class ConversationDatabase:
    def __init__(self, db_path: str = "/app/conversations.db"):
        self.db_path = db_path
        self.init_database()

    def init_database(self):
        """Initialize the database and create tables if they don't exist"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            # Conversations table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS conversations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    title TEXT,
                    metadata TEXT
                )
            ''')

            # Messages table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id INTEGER NOT NULL,
                    role TEXT NOT NULL, -- 'user' or 'assistant'
                    content TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    metadata TEXT, -- JSON field for additional data
                    FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
                )
            ''')

            # Create indexes for better performance
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)')

            conn.commit()

    def create_conversation(self, session_id: str, title: Optional[str] = None, metadata: Optional[Dict] = None) -> int:
        """Create a new conversation and return its ID"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO conversations (session_id, title, metadata)
                VALUES (?, ?, ?)
            ''', (session_id, title, json.dumps(metadata) if metadata else None))
            conn.commit()
            return cursor.lastrowid or 0

    def add_message(self, conversation_id: int, role: str, content: str, metadata: Optional[Dict] = None) -> int:
        """Add a message to a conversation"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            # Add the message
            cursor.execute('''
                INSERT INTO messages (conversation_id, role, content, metadata)
                VALUES (?, ?, ?, ?)
            ''', (conversation_id, role, content, json.dumps(metadata) if metadata else None))

            # Update conversation's updated_at timestamp
            cursor.execute('''
                UPDATE conversations
                SET updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (conversation_id,))

            conn.commit()
            return cursor.lastrowid or 0

    def get_conversation_messages(self, conversation_id: int, limit: Optional[int] = None) -> List[Dict]:
        """Get all messages for a conversation"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            query = '''
                SELECT role, content, timestamp, metadata
                FROM messages
                WHERE conversation_id = ?
                ORDER BY timestamp ASC
            '''
            params = [conversation_id]

            if limit:
                query += ' LIMIT ?'
                params.append(limit)

            cursor.execute(query, params)
            rows = cursor.fetchall()

            messages = []
            for row in rows:
                role, content, timestamp, metadata = row
                message = {
                    'role': role,
                    'content': content,
                    'timestamp': timestamp
                }
                if metadata:
                    message['metadata'] = json.loads(metadata)
                messages.append(message)

            return messages

    def get_recent_conversations(self, session_id: str, limit: int = 10) -> List[Dict]:
        """Get recent conversations for a session"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT id, title, created_at, updated_at, metadata
                FROM conversations
                WHERE session_id = ?
                ORDER BY updated_at DESC
                LIMIT ?
            ''', (session_id, limit))

            conversations = []
            for row in cursor.fetchall():
                conv_id, title, created_at, updated_at, metadata = row
                conv = {
                    'id': conv_id,
                    'title': title,
                    'created_at': created_at,
                    'updated_at': updated_at,
                    'message_count': self.get_message_count(conv_id)
                }
                if metadata:
                    conv['metadata'] = json.loads(metadata)
                conversations.append(conv)

            return conversations

    def get_message_count(self, conversation_id: int) -> int:
        """Get the number of messages in a conversation"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT COUNT(*) FROM messages WHERE conversation_id = ?', (conversation_id,))
            return cursor.fetchone()[0]

    def get_conversation_by_id(self, conversation_id: int) -> Optional[Dict]:
        """Get conversation details by ID"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT session_id, title, created_at, updated_at, metadata
                FROM conversations
                WHERE id = ?
            ''', (conversation_id,))

            row = cursor.fetchone()
            if row:
                session_id, title, created_at, updated_at, metadata = row
                conv = {
                    'id': conversation_id,
                    'session_id': session_id,
                    'title': title,
                    'created_at': created_at,
                    'updated_at': updated_at,
                    'messages': self.get_conversation_messages(conversation_id)
                }
                if metadata:
                    conv['metadata'] = json.loads(metadata)
                return conv
            return None

    def delete_conversation(self, conversation_id: int) -> bool:
        """Delete a conversation and all its messages"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM conversations WHERE id = ?', (conversation_id,))
            conn.commit()
            return cursor.rowcount > 0

    def search_messages(self, query: str, session_id: Optional[str] = None, limit: int = 20) -> List[Dict]:
        """Search messages containing the query"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            sql = '''
                SELECT m.id, m.conversation_id, m.role, m.content, m.timestamp, c.title
                FROM messages m
                JOIN conversations c ON m.conversation_id = c.id
                WHERE m.content LIKE ?
            '''
            params = [f'%{query}%']

            if session_id:
                sql += ' AND c.session_id = ?'
                params.append(session_id)

            sql += ' ORDER BY m.timestamp DESC LIMIT ?'
            params.append(limit)

            cursor.execute(sql, params)
            results = []
            for row in cursor.fetchall():
                msg_id, conv_id, role, content, timestamp, title = row
                results.append({
                    'message_id': msg_id,
                    'conversation_id': conv_id,
                    'conversation_title': title,
                    'role': role,
                    'content': content,
                    'timestamp': timestamp
                })

            return results

    def cleanup_old_conversations(self, days_old: int = 30) -> int:
        """Delete conversations older than specified days"""
        cutoff_date = datetime.now() - timedelta(days=days_old)

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                DELETE FROM conversations
                WHERE updated_at < ?
            ''', (cutoff_date.isoformat(),))
            conn.commit()
            return cursor.rowcount

    def get_conversation_stats(self) -> Dict:
        """Get database statistics"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()

            # Total conversations
            cursor.execute('SELECT COUNT(*) FROM conversations')
            total_conversations = cursor.fetchone()[0]

            # Total messages
            cursor.execute('SELECT COUNT(*) FROM messages')
            total_messages = cursor.fetchone()[0]

            # Conversations by session
            cursor.execute('''
                SELECT session_id, COUNT(*) as count
                FROM conversations
                GROUP BY session_id
                ORDER BY count DESC
                LIMIT 10
            ''')
            sessions = cursor.fetchall()

            return {
                'total_conversations': total_conversations,
                'total_messages': total_messages,
                'sessions': [{'session_id': s[0], 'conversation_count': s[1]} for s in sessions]
            }

# Global database instance
db = ConversationDatabase()

# Helper functions for easy access
def get_or_create_conversation(session_id: str, title: Optional[str] = None) -> int:
    """Get the most recent conversation for a session, or create a new one"""
    recent = db.get_recent_conversations(session_id, 1)
    if recent:
        return recent[0]['id']
    else:
        return db.create_conversation(session_id, title)

def add_message_to_session(session_id: str, role: str, content: str, title: Optional[str] = None) -> int:
    """Add a message to the current conversation for a session"""
    conv_id = get_or_create_conversation(session_id, title)
    return db.add_message(conv_id, role, content)

def get_session_history(session_id: str, limit: Optional[int] = None) -> List[Dict]:
    """Get the message history for a session"""
    conv_id = get_or_create_conversation(session_id)
    return db.get_conversation_messages(conv_id, limit)