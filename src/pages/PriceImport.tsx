import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Save, Search, CheckCircle2, ArrowLeft, Download } from 'lucide-react';
import { parseExcel, downloadTemplate } from '../utils/excel'; // Добавили downloadTemplate
import { db, WbProduct } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';

interface ImportedRow {
  tempId: number;
  name: string;
  price: number;
  startDate: string;
  endDate: string;
  nmId?: number;
  wbTitle?: string;
}

export default function PriceImport() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [rows, setRows] = useState<ImportedRow[]>([]);
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const wbProducts = useLiveQuery(() => db.products.toArray()) || [];

  // МАГИЯ №1: Закрываем поиск при клике в любое пустое место экрана
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

  const handleSelectProduct = (rowIndex: number, product: WbProduct) => {
    const newRows = [...rows];
    newRows[rowIndex].nmId = product.nmID;
    newRows[rowIndex].wbTitle = product.title;
    setRows(newRows);
    setFocusedRow(null);
    setSearchQuery('');
  };

  const handleSaveAll = async () => {
    const pricesToSave = rows.map(r => ({
      name: r.name,
      price: r.price,
      startDate: r.startDate,
      endDate: r.endDate,
      nmId: r.nmId
    }));

    await db.prices.clear();
    await db.prices.bulkAdd(pricesToSave);
    navigate('/');
  };

  // МАГИЯ №2: Убрали .slice(0, 5), чтобы показывались все результаты для скролла
  const filteredProducts = wbProducts.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.vendorCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(p.nmID).includes(searchQuery)
  );

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
            {/* Кнопка скачивания шаблона теперь здесь */}
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
                          <CheckCircle2 size={20} className="text-green-500" />
                          <div>
                            <p className="text-sm font-bold text-gray-900 line-clamp-1">{row.wbTitle}</p>
                            <p className="text-xs text-gray-500">Арт. ВБ: {row.nmId}</p>
                          </div>
                        </div>
                        <button onClick={() => { const newRows = [...rows]; newRows[index].nmId = undefined; setRows(newRows); }} className="text-xs font-bold text-red-500 hover:text-red-700 bg-white px-3 py-1.5 rounded-lg border border-red-100 shadow-sm cursor-pointer">
                          Отвязать
                        </button>
                      </div>
                    ) : (
                      // e.stopPropagation() не дает нашему клику "просочиться" и закрыть окно мгновенно
                      <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
                        <div className="relative">
                          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input 
                            type="text"
                            placeholder="Поиск по названию или артикулу..."
                            className="w-full bg-white border border-gray-300 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none"
                            onFocus={() => setFocusedRow(index)}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                        </div>

                        {focusedRow === index && (
                          // МАГИЯ №3: max-h-64 и overflow-y-auto делают список прокручиваемым!
                          <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 z-50 max-h-64 overflow-y-auto">
                            {filteredProducts.length === 0 ? (
                              <div className="p-4 text-sm text-gray-500 text-center">Ничего не найдено</div>
                            ) : (
                              filteredProducts.map(p => (
                                <div key={p.nmID} onMouseDown={() => handleSelectProduct(index, p)} className="p-3 hover:bg-blue-50 cursor-pointer flex items-center gap-3 border-b border-gray-50 last:border-0">
                                  {p.photo ? <img src={p.photo} alt="img" className="w-8 h-12 object-cover rounded shadow-sm" /> : <div className="w-8 h-12 bg-gray-100 rounded" />}
                                  <div>
                                    <p className="text-sm font-bold text-gray-900 line-clamp-1">{p.title}</p>
                                    <p className="text-xs text-gray-500">Арт: {p.vendorCode} | ШК: {p.nmID}</p>
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