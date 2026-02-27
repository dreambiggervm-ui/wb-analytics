import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { RefreshCw, Edit3, X, Save, Search, Plus, Trash2 } from 'lucide-react';
import { fetchWbProducts } from '../utils/api';
import { db, WbProduct } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';

interface PricePeriod {
  id?: number;
  price: number | '';
  startDate: string;
  endDate: string;
}

export default function Products() {
  const [isSyncing, setIsSyncing] = useState(false);
  const token = import.meta.env.VITE_WB_API_KEY_CONTENT;
  
  const location = useLocation();
  const navigate = useNavigate();

  const savedProducts = useLiveQuery(() => db.products.toArray()) || [];
  const savedPrices = useLiveQuery(() => db.prices.toArray()) || [];

  const [searchQuery, setSearchQuery] = useState('');
  
  // Состояния для модального окна
  const [editingProduct, setEditingProduct] = useState<WbProduct | null>(null);
  const [modalPrices, setModalPrices] = useState<PricePeriod[]>([]);

  // ==========================================
  // ПОИСК И СОРТИРОВКА (СВЕЖИЕ СВЕРХУ)
  // ==========================================
  const processedProducts = useMemo(() => {
    let result = [...savedProducts];

    // 1. Поиск
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p => 
        String(p.nmID).includes(q) || 
        p.vendorCode.toLowerCase().includes(q) || 
        p.title.toLowerCase().includes(q)
      );
    }

    // 2. Группировка цен и Сортировка
    const productsWithPrices = result.map(product => {
      const productPrices = savedPrices.filter(price => price.nmId === product.nmID);
      
      // Ищем самую свежую дату обновления (или id) для сортировки
      // При сохранении мы будем добавлять поле updatedAt
      const lastUpdated = Math.max(...productPrices.map(p => (p as any).updatedAt || p.id || 0), 0);
      
      return {
        ...product,
        // Сортируем цены от новых дат к старым для красивого отображения
        prices: productPrices.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || '')),
        lastUpdated
      };
    });

    // Сортируем: недавно измененные товары (с наибольшим lastUpdated) идут первыми
    productsWithPrices.sort((a, b) => b.lastUpdated - a.lastUpdated);

    return productsWithPrices;
  }, [savedProducts, savedPrices, searchQuery]);

  // ==========================================
  // ЛОВИМ ПЕРЕХОД ИЗ АНАЛИТИКИ
  // ==========================================
  useEffect(() => {
    if (location.state?.openEditModalNmId && processedProducts.length > 0) {
      const targetProduct = processedProducts.find(p => p.nmID === location.state.openEditModalNmId);
      if (targetProduct) {
        openEditModal(targetProduct);
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state, processedProducts, navigate]);

  const handleSyncProducts = async () => {
    if (!token) return alert('ОШИБКА: API Токен Контент не найден!');
    setIsSyncing(true);
    try {
      const products = await fetchWbProducts(token);
      await db.products.clear();
      await db.products.bulkAdd(products);
    } catch (error: any) { alert(error.message); } finally { setIsSyncing(false); }
  };

  // ==========================================
  // ЛОГИКА МОДАЛЬНОГО ОКНА МНОЖЕСТВЕННЫХ ЦЕН
  // ==========================================
  const openEditModal = (product: any) => {
    setEditingProduct(product);
    if (product.prices && product.prices.length > 0) {
      // Если цены есть - копируем их в модалку
      setModalPrices(product.prices.map((p: any) => ({ ...p })));
    } else {
      // Если цен нет - создаем одну пустую строку
      setModalPrices([{ price: '', startDate: '', endDate: '' }]);
    }
  };

  const handleAddPricePeriod = () => {
    setModalPrices([...modalPrices, { price: '', startDate: '', endDate: '' }]);
  };

  const handleRemovePricePeriod = (index: number) => {
    const newPrices = [...modalPrices];
    newPrices.splice(index, 1);
    setModalPrices(newPrices);
  };

  const handlePriceChange = (index: number, field: keyof PricePeriod, value: string) => {
    const newPrices = [...modalPrices];
    newPrices[index] = { ...newPrices[index], [field]: value };
    setModalPrices(newPrices);
  };

  const handleSavePrices = async () => {
    if (!editingProduct) return;
    
    // Фильтруем пустые строки (где не ввели цену)
    const validPrices = modalPrices.filter(p => p.price !== '' && Number(p.price) > 0);
    
    // 1. Удаляем все старые цены для этого товара
    await db.prices.where('nmId').equals(editingProduct.nmID).delete();

    // 2. Добавляем новые (с меткой времени для сортировки "Недавно измененные")
    if (validPrices.length > 0) {
      const now = Date.now();
      const toInsert = validPrices.map(p => ({
        name: editingProduct.title,
        nmId: editingProduct.nmID,
        price: Number(p.price),
        startDate: p.startDate,
        endDate: p.endDate,
        updatedAt: now // Метка для сортировки
      }));
      await db.prices.bulkAdd(toInsert as any);
    }
    
    setEditingProduct(null);
  };

  return (
    <div className="p-8 w-full h-full flex flex-col space-y-6 relative">
      
      {/* Шапка */}
      <div className="flex justify-between items-center flex-shrink-0">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">Каталог товаров</h1>
          <p className="text-lg text-gray-500 mt-2">Управление себестоимостью по периодам дат</p>
        </div>
        <button onClick={handleSyncProducts} disabled={isSyncing} className="flex items-center gap-2 px-6 py-3 bg-gray-900 text-white rounded-xl text-base font-semibold hover:bg-gray-800 transition-colors shadow-md disabled:opacity-50 cursor-pointer">
          <RefreshCw size={20} className={isSyncing ? "animate-spin" : ""} />
          {isSyncing ? "Загрузка..." : "Обновить товары WB"}
        </button>
      </div>

      {/* ПАНЕЛЬ ПОИСКА */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex items-center gap-4 flex-shrink-0">
        <div className="relative flex-1">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input 
            type="text" 
            placeholder="Поиск по названию, артикулу или ШК..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-12 pr-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          />
        </div>
      </div>

      {/* ТАБЛИЦА КАТАЛОГА */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex-1 overflow-hidden flex flex-col">
        {processedProducts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-16">
            <Search size={48} className="text-gray-300 mb-6" />
            <h3 className="text-2xl font-semibold text-gray-900">Товары не найдены</h3>
            <p className="text-lg text-gray-500 mt-2">Измените запрос или нажмите «Обновить товары WB».</p>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-gray-50/95 backdrop-blur-md z-10 border-b border-gray-200 shadow-sm">
                <tr className="text-sm uppercase tracking-widest text-gray-500 font-bold">
                  <th className="px-8 py-5 w-24">Фото</th>
                  <th className="px-8 py-5 w-48">Артикул WB</th>
                  <th className="px-8 py-5">Наименование товара</th>
                  <th className="px-8 py-5 text-right w-80">История себестоимости</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {processedProducts.map((product) => (
                  <tr key={product.nmID} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-8 py-4">
                      {product.photo ? <img src={product.photo} alt="img" className="w-14 h-20 object-cover rounded-lg border border-gray-200 shadow-sm" /> : <div className="w-14 h-20 bg-gray-100 rounded-lg flex items-center justify-center text-xs text-gray-400">Нет</div>}
                    </td>
                    <td className="px-8 py-4"><span className="font-mono text-base font-semibold text-gray-700 bg-gray-100 px-3 py-1.5 rounded-lg border border-gray-200">{product.nmID}</span></td>
                    <td className="px-8 py-4">
                      <p className="text-lg font-semibold text-gray-900 line-clamp-2 leading-tight">{product.title}</p>
                      <p className="text-sm font-medium text-gray-500 mt-1.5">Арт: {product.vendorCode}</p>
                    </td>
                    <td className="px-8 py-4 text-right align-top pt-6">
                      <div className="flex justify-end gap-4">
                        <button onClick={() => openEditModal(product)} className="p-2 h-10 w-10 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100 cursor-pointer" title="Редактировать периоды">
                          <Edit3 size={20} />
                        </button>
                        
                        {/* ОТОБРАЖЕНИЕ ПЕРИОДОВ ЦЕН */}
                        {product.prices.length > 0 ? (
                          <div className="flex flex-col gap-2 items-end">
                            {product.prices.map((p: any, idx: number) => (
                              <div key={idx} className="flex items-center gap-3">
                                <span className="text-xs font-medium text-gray-400 bg-white border border-gray-200 px-2 py-1 rounded">
                                  {p.startDate ? new Date(p.startDate).toLocaleDateString('ru-RU') : '...'} — {p.endDate ? new Date(p.endDate).toLocaleDateString('ru-RU') : '∞'}
                                </span>
                                <span className="text-sm font-bold text-green-700 bg-green-50 border border-green-100 px-3 py-1 rounded-lg shadow-sm">
                                  {p.price} р
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <button onClick={() => openEditModal(product)} className="h-10 text-sm font-semibold text-blue-600 bg-blue-50 hover:bg-blue-600 hover:text-white px-4 rounded-xl transition-all cursor-pointer">
                            + Внести цены
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ ПЕРИОДОВ */}
      {editingProduct && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
            
            <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/80 flex-shrink-0">
              <h3 className="text-xl font-bold text-gray-900">Управление себестоимостью</h3>
              <button onClick={() => setEditingProduct(null)} className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-full transition-colors cursor-pointer"><X size={24} /></button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <div className="flex items-center gap-4 mb-6 bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                {editingProduct.photo && <img src={editingProduct.photo} alt="img" className="w-12 h-16 object-cover rounded shadow-sm" />}
                <div>
                  <p className="font-bold text-gray-900 line-clamp-2">{editingProduct.title}</p>
                  <p className="text-sm text-gray-500 mt-1">Арт: {editingProduct.vendorCode}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-end mb-2">
                  <h4 className="font-bold text-gray-800">Периоды цен</h4>
                  <span className="text-xs text-gray-400">Если "От" и "До" пустые, цена действует всегда</span>
                </div>
                
                {modalPrices.map((p, index) => (
                  <div key={index} className="flex items-end gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-200 relative group transition-colors hover:border-blue-300">
                    <div className="w-1/3">
                      <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Опт (р) *</label>
                      <input type="number" value={p.price} onChange={(e) => handlePriceChange(index, 'price', e.target.value)} className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-3 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow" placeholder="Напр: 450" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Действует От</label>
                      <input type="date" value={p.startDate} onChange={(e) => handlePriceChange(index, 'startDate', e.target.value)} className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow cursor-pointer" />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">Действует До</label>
                      <input type="date" value={p.endDate} onChange={(e) => handlePriceChange(index, 'endDate', e.target.value)} className="w-full bg-white border border-gray-200 rounded-xl py-2.5 px-3 text-sm text-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow cursor-pointer" />
                    </div>
                    <button onClick={() => handleRemovePricePeriod(index)} className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors mb-[1px]" title="Удалить период">
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}

                <button onClick={handleAddPricePeriod} className="flex items-center justify-center gap-2 w-full py-3 border-2 border-dashed border-gray-300 rounded-2xl text-sm font-bold text-gray-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-all cursor-pointer">
                  <Plus size={18} /> Добавить новый период
                </button>
              </div>
            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-4 flex-shrink-0">
              <button onClick={() => setEditingProduct(null)} className="flex-1 py-3.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-100 transition-colors cursor-pointer">Отмена</button>
              <button onClick={handleSavePrices} className="flex-1 py-3.5 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 cursor-pointer"><Save size={20} /> Сохранить периоды</button>
            </div>
            
          </div>
        </div>
      )}

    </div>
  )
}