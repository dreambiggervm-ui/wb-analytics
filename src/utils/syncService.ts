import { db } from '../db'; // Твой текущий файл с Dexie

const API_URL = 'http://localhost:3001/api';

export const SyncService = {
  // Функция для отправки данных таблицы из Dexie в SQLite
  async syncTableToServer(tableName: string) {
    try {
      // @ts-ignore - обращаемся к таблице Dexie динамически
      const tableData = await db[tableName].toArray();
      
      const response = await fetch(`${API_URL}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableName,
          data: tableData
        })
      });
      
      if (!response.ok) throw new Error('Sync failed');
      console.log(`✅ Таблица ${tableName} успешно сохранена локально!`);
    } catch (error) {
      console.error(`❌ Ошибка синхронизации таблицы ${tableName}:`, error);
    }
  },

  // Функция полного бекапа всей БД на локальный сервер
  async syncAllToServer() {
    const tables = db.tables.map(table => table.name);
    for (const tableName of tables) {
      await this.syncTableToServer(tableName);
    }
    console.log('🎉 Полная синхронизация с локальным сервером завершена!');
  }
};