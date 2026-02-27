import { useState, useMemo, useRef } from 'react';
import { Upload, Plus, PackageSearch, Copy, Check, Trash2, Edit3 } from 'lucide-react';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';

// ИМПОРТИРУЕМ НАШ UI KIT
import { PageLayout, Toolbar, SearchInput, Button, TableWrapper, EmptyState } from '../components/ui';

export default function MyWarehouse() {
  const stockItems = useLiveQuery(() => db.myWarehouse.toArray()) || [];
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Фильтрация и сортировка
  const filteredItems = useMemo(() => {
    let result = [...stockItems];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(item => 
        item.title.toLowerCase().includes(q) || 
        item.article.toLowerCase().includes(q) || 
        item.barcode.toLowerCase().includes(q) ||
        item.brand.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  }, [stockItems, searchQuery]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedBarcode(text);
    setTimeout(() => setCopiedBarcode(null), 2000);
  };

  const handleDelete = async (id?: number) => {
    if (id && window.confirm('Удалить товар со склада?')) {
      await db.myWarehouse.delete(id);
    }
  };

  // Место для логики парсинга Excel (потребуется библиотека xlsx)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    alert(`Файл ${file.name} выбран! Здесь будет логика чтения Excel через xlsx.`);
    // Сброс инпута
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <PageLayout>
      <Toolbar>
        <div className="flex items-center gap-4">
          <h1 className="text-[16px] font-bold text-[#1e3a5f] pr-4 border-r border-gray-200 uppercase tracking-wider">Мой Склад</h1>
          <SearchInput value={searchQuery} onChange={setSearchQuery} placeholder="Поиск по названию, артикулу или бренду..." />
        </div>
        
        <div className="flex items-center gap-3">
          {/* Скрытый инпут для файлов */}
          <input type="file" accept=".xlsx, .xls" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
          
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload size={16} className="text-gray-500" />
            Загрузить Excel
          </Button>

          <Button onClick={() => alert('Открытие модалки добавления товара (в разработке)')}>
            <Plus size={16} /> Добавить товар
          </Button>
        </div>
      </Toolbar>

      <TableWrapper>
        {filteredItems.length === 0 ? (
          <EmptyState icon={PackageSearch} title="Склад пуст" description="Нажмите «Добавить товар» или загрузите остатки из Excel." />
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 z-20">
                <tr className="text-[11px] uppercase tracking-wider text-gray-500 font-bold bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-2.5 sticky left-0 bg-gray-50 z-30 shadow-[1px_0_0_0_#e5e7eb]">Товар (Артикул и Название)</th>
                  <th className="px-4 py-2.5 border-r border-gray-100 w-32">Баркод</th>
                  <th className="px-4 py-2.5 border-r border-gray-100 text-center w-24">Остаток</th>
                  <th className="px-4 py-2.5 border-r border-gray-100 text-right w-24">Цена закупки</th>
                  <th className="px-4 py-2.5 text-center w-16">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/80 transition-colors bg-white group">
                    
                    <td className="px-4 py-3 sticky left-0 bg-white group-hover:bg-gray-50/80 z-10 shadow-[1px_0_0_0_#f3f4f6] whitespace-normal min-w-[320px] max-w-[420px]">
                      <div className="flex flex-col justify-center">
                        <h3 className="text-[13px] font-bold text-[#1e3a5f] leading-tight line-clamp-2">{item.title}</h3>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="text-[12px] text-gray-500 font-medium">Арт: {item.article}</span>
                          {item.brand && (
                            <span className="bg-[#8ba5ca]/15 text-[#5a769a] px-1.5 py-0.5 rounded text-[10px] font-bold border border-[#8ba5ca]/20">
                              Бренд: {item.brand}
                            </span>
                          )}
                          {item.category && (
                            <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-gray-200">
                              {item.category}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 border-r border-gray-100 align-middle">
                      <div onClick={() => handleCopy(item.barcode)} className="flex items-center gap-2 group/copy cursor-pointer w-max">
                        <span className="text-[13px] font-medium text-[#1e3a5f] tracking-wide">{item.barcode}</span>
                        {copiedBarcode === item.barcode ? <Check size={14} className="text-green-500" /> : <Copy size={14} className="text-gray-300 group-hover/copy:text-blue-500 transition-colors" />}
                      </div>
                    </td>

                    <td className="px-4 py-3 border-r border-gray-100 text-center align-middle">
                       <div className={`inline-flex items-center justify-center min-w-[36px] h-[28px] px-2 border rounded-md text-[13px] font-bold shadow-sm ${item.quantity > 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                          {item.quantity} шт
                       </div>
                    </td>

                    <td className="px-4 py-3 border-r border-gray-100 text-right align-middle">
                       <span className="text-[13px] font-bold text-gray-800">{item.price} ₽</span>
                    </td>

                    <td className="px-4 py-3 text-center align-middle">
                      <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button className="text-gray-400 hover:text-blue-600 transition-colors"><Edit3 size={16}/></button>
                        <button onClick={() => handleDelete(item.id)} className="text-gray-400 hover:text-red-600 transition-colors"><Trash2 size={16}/></button>
                      </div>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TableWrapper>
    </PageLayout>
  )
}