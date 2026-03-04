import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3001;

// Разрешаем CORS и увеличиваем лимит для JSON (база может быть большой)
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Создаем базу данных SQLite прямо в папке server
const dbPath = path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

// Инициализация универсальной таблицы для хранения слепков таблиц Dexie
db.exec(`
  CREATE TABLE IF NOT EXISTS WbAnalyticsDB (
    tableName TEXT PRIMARY KEY,
    data JSON,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// API: Сохранение данных (Синхронизация из Dexie в SQLite)
app.post('/api/sync', (req, res) => {
  try {
    const { tableName, data } = req.body;
    
    if (!tableName || !data) {
      return res.status(400).json({ error: 'Missing tableName or data' });
    }

    const stmt = db.prepare(`
      INSERT INTO WbAnalyticsDB (tableName, data, updatedAt) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(tableName) DO UPDATE SET 
      data = excluded.data, 
      updatedAt = CURRENT_TIMESTAMP
    `);
    
    stmt.run(tableName, JSON.stringify(data));
    res.json({ success: true, message: `Table ${tableName} synced successfully` });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Failed to sync data' });
  }
});

// API: Загрузка данных (Восстановление из SQLite в Dexie при старте)
app.get('/api/sync/:tableName', (req, res) => {
  try {
    const { tableName } = req.params;
    const stmt = db.prepare('SELECT data FROM WbAnalyticsDB WHERE tableName = ?');
    const row = stmt.get(tableName);
    
    if (row) {
      res.json({ success: true, data: JSON.parse(row.data) });
    } else {
      res.json({ success: true, data: [] });
    }
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Local ERP Server is running on http://localhost:${PORT}`);
  console.log(`📁 Database saved at: ${dbPath}`);
});