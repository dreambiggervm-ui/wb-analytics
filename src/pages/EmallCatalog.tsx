import React, { useState } from 'react';
import { db } from '../db';
import { fetchEmallProducts } from '../utils/emallApi';
import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw, Link as LinkIcon, AlertCircle } from 'lucide-react';

export default function EmallCatalog() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Получаем данные из БД
  const emallProducts = useLiveQuery(() => db.emallProducts.toArray()) || [];
  const localItems = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  const emallLinks = useLiveQuery(() => db.emallLinks.toArray()) || [];

  // Загрузка каталога из API (берем ключ из .env)
  const handleFetchCatalog = async () => {
    // В Vite переменные окружения доступны через import.meta.env
    const apiKey = import.meta.env.VITE_EMALL_API_KEY;

    if (!apiKey) {
      setError('API ключ Emall не найден! Добавьте VITE_EMALL_API_KEY в файл .env и перезапустите сервер.');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      const productsFromApi = await fetchEmallProducts(apiKey);
      
      // Обновляем локальную БД Emall
      await db.emallProducts.clear();
      await db.emallProducts.bulkAdd(productsFromApi);
      
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки каталога. Проверьте валидность API-ключа.');
    } finally {
      setIsLoading(false);
    }
  };

  // Создание связи между Emall и Моим складом
  const handleLinkChange = async (emallProductId: string, myStockItemId: string) => {
    if (!myStockItemId) {
      // Если выбрали пустое значение — удаляем связь
      await db.emallLinks.where('emallProductId').equals(emallProductId).delete();
      return;
    }

    const stockIdNum = Number(myStockItemId);
    
    // Ищем, есть ли уже связь, и обновляем или создаем новую
    const existingLink = await db.emallLinks.where('emallProductId').equals(emallProductId).first();
    if (existingLink) {
      await db.emallLinks.put({ emallProductId, myStockItemId: stockIdNum });
    } else {
      await db.emallLinks.add({ emallProductId, myStockItemId: stockIdNum });
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Каталог Emall</h1>
          <p className="text-gray-500 text-sm mt-1">Свяжите карточки Emall с физическим складом</p>
        </div>
        
        {/* Оставили только красивую кнопку синхронизации */}
        <button
          onClick={handleFetchCatalog}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 transition-colors text-sm font-medium shadow-sm"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Синхронизировать
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-center gap-3 border border-red-100">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-500">
              <th className="p-4 font-medium">Фото</th>
              <th className="p-4 font-medium">Товар Emall</th>
              <th className="p-4 font-medium">Артикул</th>
              <th className="p-4 font-medium">Связь с «Моим складом»</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {emallProducts.length === 0 && !isLoading && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-gray-500">
                  Товары не найдены. Нажмите "Синхронизировать", чтобы загрузить каталог.
                </td>
              </tr>
            )}
            
            {emallProducts.map((product) => {
              // Ищем привязанный товар
              const currentLink = emallLinks.find(link => link.emallProductId === product.id);

              return (
                <tr key={product.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="p-4 w-20">
                    <div className="w-12 h-16 bg-gray-100 rounded border border-gray-200 overflow-hidden flex items-center justify-center">
                      {product.photo ? (
                        <img src={product.photo} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs text-gray-400">Нет фото</span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 font-medium text-gray-800">{product.title}</td>
                  <td className="p-4 text-gray-500 text-sm">{product.article}</td>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <LinkIcon className={`w-4 h-4 ${currentLink ? 'text-green-500' : 'text-gray-300'}`} />
                      <select
                        className={`text-sm rounded-md shadow-sm border focus:ring-purple-500 focus:border-purple-500 p-2 outline-none ${
                          currentLink ? 'bg-green-50 border-green-200 font-medium' : 'bg-gray-50 border-gray-200'
                        }`}
                        value={currentLink?.myStockItemId || ''}
                        onChange={(e) => handleLinkChange(product.id, e.target.value)}
                      >
                        <option value="">-- Не связано --</option>
                        {localItems.map(item => (
                          <option key={item.id} value={item.id}>
                            {item.title} (Остаток: {item.quantity})
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}