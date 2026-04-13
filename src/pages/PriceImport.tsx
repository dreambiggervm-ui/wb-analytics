import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Save, Search, CheckCircle2, ArrowLeft } from 'lucide-react';
import { parseExcel, downloadTemplate } from '../utils/excel'; 
import { db, FbsStockItem } from '../db'; // ОБНОВЛЕНО: Используем FbsStockItem вместо WbProduct
import { useLiveQuery } from 'dexie-react-hooks';

// ОБНОВЛЕНО: Расширили интерфейс для красивого отображения после привязки
interface ImportedRow {
  tempId: number;
  name: string;
  price: number;
  startDate: string;
  endDate: string;
  nmId?: number;
  wbTitle?: string;
  photo?: string;
  techSize?: string;
  vendorCode?: string;
}

export default function PriceImport() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ОБНОВЛЕНО: Берем товары из fbsStocks (там есть размеры и штрихкоды!)
  const wbProducts = useLiveQuery(() => db.fbsStocks.toArray()) || [];

  // Закрываем поиск при клике в пустое место
  useEffect(() => {
    const handleClickOutside = () => setFocusedRow(null);
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const data = await parseExcel(file);
      const formatted = data.map((row, index) => ({
        tempId: index,
        name: String(row["Наименование"] || ""),
        price: Number(row["Цена (Опт)"] || 0),
        startDate: String(row["Дата начала"] || ""),
        endDate: String(row["Дата окончания"] || ""),
      }));
      setRows(formatted);
    } catch (error) {
      alert("Ошибка при чтении файла Excel!");
    }
  };

  // ОБНОВЛЕНО: Сохраняем все нужные поля для UI
  const handleSelectProduct = (rowIndex: number, product: FbsStockItem) => {
    const newRows = [...rows];
    newRows[rowIndex].nmId = product.nmId;
    newRows[rowIndex].wbTitle = product.title;
    newRows[rowIndex].photo = product.photo;
    newRows[rowIndex].techSize = product.techSize;
    newRows[rowIndex].vendorCode = product.vendorCode;
    setRows(newRows);
    setFocusedRow(null);
    setSearchQuery('');
  };

  const handleSaveAll = async () => {
    const pricesToSave = rows
      .filter(r => r.nmId) // Сохраняем только привязанные
      .map(r => ({
        name: r.name,
        price: r.price,
        startDate: r.startDate,
        endDate: r.endDate,
        nmId: r.nmId
      }));

    if (pricesToSave.length === 0) return alert('Нет привязанных товаров для сохранения!');

    // ВАЖНО: Мы не делаем db.prices.clear(), чтобы не удалить старые цены других товаров.
    // Мы удаляем только старые цены ТЕХ товаров, которые сейчас импортируем.
    const nmIdsToUpdate = pricesToSave.map(p => p.nmId);
    await db.prices.where('nmId').anyOf(nmIdsToUpdate as number[]).delete();
    
    await db.prices.bulkAdd(pricesToSave);
    alert('Цены успешно обновлены!');
    navigate('/catalog'); // Возвращаемся в каталог
  };

  // ОБНОВЛЕНО: Мощный поиск по всем полям, включая штрихкоды и размеры
  const filteredProducts = useMemo(() => {
    if (!searchQuery) return wbProducts;
    const q = searchQuery.toLowerCase().trim();
    return wbProducts.filter(p => 
      p.title.toLowerCase().includes(q) || 
      p.vendorCode.toLowerCase().includes(q) ||
      String(p.nmId).includes(q) ||
      (p.techSize && p.techSize.toLowerCase().includes(q)) ||
      (p.barcodes && p.barcodes.some(b => b.toLowerCase().includes(q)))
    );
  }, [wbProducts, searchQuery]);

  if (rows.length === 0) {
    return (
      <div className="p-8 w-full h-full flex flex-col items-center justify-center bg-[#F5F5F7]">
        <div className="bg-white p-12 rounded-3xl shadow-sm border border-gray-200 text-center max-w-lg w-full">
          <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Upload size={32} className="text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Импорт себестоимости</h2>
          <p className="text-gray-500 mt-2 mb-8">Загрузите файл Excel со списком оптовых цен, чтобы привязать их к товарам.</p>
          
          <div className="flex flex-col gap-3">
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-4 bg-blue-600 text-white rounded-xl text-lg font-semibold hover:bg-blue-700 transition-colors shadow-md cursor-pointer"
            >
              Загрузить заполненный Excel
            </button>
            <button 
              onClick={downloadTemplate}
              className="w-full py-4 bg-gray-50 text-gray-700 rounded-xl text-lg font-semibold hover:bg-gray-100 transition-colors border border-gray-200 cursor-pointer"
            >
              Скачать пустой шаблон
            </button>
          </div>
          <input type="file" accept=".xlsx, .xls" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 w-full h-full flex flex-col space-y-6">
      <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => setRows([])} className="p-2 text-gray-400 hover:bg-gray-100 rounded-full transition-colors cursor-pointer">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Привязка товаров</h1>
            <p className="text-gray-500">Найдено строк: {rows.length}</p>
          </div>
        </div>
        <button onClick={handleSaveAll} className="flex items-center gap-2 px-8 py-3 bg-green-500 text-white rounded-xl text-base font-bold hover:bg-green-600 transition-colors shadow-md cursor-pointer">
          <Save size={20} /> Сохранить в базу
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 flex-1 overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1 pb-48">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-gray-50/95 backdrop-blur-md z-10 border-b border-gray-200">
              <tr className="text-xs uppercase tracking-widest text-gray-500 font-bold">
                <th className="px-6 py-4 w-1/3">Наименование (из Excel)</th>
                <th className="px-6 py-4 w-32">Опт. цена</th>
                <th className="px-6 py-4">Связанный товар Wildberries</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, index) => (
                <tr key={row.tempId} className={`transition-colors ${row.nmId ? 'bg-green-50/20' : 'hover:bg-gray-50'}`}>
                  <td className="px-6 py-4"><p className="font-semibold text-gray-900">{row.name}</p></td>
                  <td className="px-6 py-4"><span className="font-bold text-gray-700">{row.price} ₽</span></td>
                  <td className="px-6 py-4 relative">
                    {row.nmId ? (
                      <div className="flex justify-between items-center bg-green-50 border border-green-200 rounded-xl p-3">
                        <div className="flex items-center gap-3">
                          {row.photo ? <img src={row.photo} alt="img" className="w-10 h-10 object-cover rounded shadow-sm border border-green-200" /> : <CheckCircle2 size={24} className="text-green-500" />}
                          <div className="flex flex-col">
                            <p className="text-[13px] font-bold text-gray-900 line-clamp-1">{row.wbTitle}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[11px] text-gray-500 font-medium">Арт: {row.vendorCode}</span>
                              {row.techSize && row.techSize !== '0' && <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded text-[10px] font-bold">Разм: {row.techSize}</span>}
                            </div>
                          </div>
                        </div>
                        <button onClick={() => { const newRows = [...rows]; newRows[index].nmId = undefined; setRows(newRows); }} className="text-xs font-bold text-red-500 hover:text-red-700 bg-white px-3 py-1.5 rounded-lg border border-red-100 shadow-sm cursor-pointer ml-4 transition-colors">
                          Отвязать
                        </button>
                      </div>
                    ) : (
                      <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                        <div className="relative">
                          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input 
                            type="text"
                            placeholder="Поиск по названию, артикулу, штрихкоду или размеру..."
                            className="w-full bg-white border border-gray-300 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                            onFocus={() => setFocusedRow(index)}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                        </div>

                        {focusedRow === index && (
                          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 z-50 max-h-72 overflow-y-auto">
                            {filteredProducts.length === 0 ? (
                              <div className="p-4 text-sm text-gray-500 text-center">Ничего не найдено</div>
                            ) : (
                              filteredProducts.map(p => (
                                <div key={p.id} onMouseDown={() => handleSelectProduct(index, p)} className="p-3 hover:bg-blue-50 cursor-pointer flex items-center gap-3 border-b border-gray-50 last:border-0 transition-colors">
                                  {p.photo ? <img src={p.photo} alt="img" className="w-10 h-14 object-cover rounded shadow-sm border border-gray-200" /> : <div className="w-10 h-14 bg-gray-100 rounded flex items-center justify-center text-[9px] text-gray-400 border border-gray-200">Нет</div>}
                                  <div className="flex flex-col">
                                    <p className="text-[13px] font-bold text-gray-900 line-clamp-1">{p.title}</p>
                                    <div className="flex flex-wrap items-center gap-2 mt-1">
                                      <span className="text-[11px] text-gray-500 font-medium">Арт: {p.vendorCode}</span>
                                      {p.techSize && p.techSize !== '0' && <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-gray-200">Разм: {p.techSize}</span>}
                                      {p.barcodes && p.barcodes[0] && <span className="text-[10px] text-gray-400">ШК: {p.barcodes[0]}</span>}
                                    </div>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}