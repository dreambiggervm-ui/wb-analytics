import { useState, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { 
  Package, BarChart3, Layers, ChevronDown, ChevronRight, Store, 
  Warehouse, Box, Truck, History, Download, UploadCloud, 
  ShoppingCart, Archive, Briefcase, Save, ShoppingBag // Добавил ShoppingBag для Emall
} from 'lucide-react';
import { db } from '../db';
import { SyncService } from '../utils/syncService'; 

export default function Sidebar() {
  const [isWbMenuOpen, setIsWbMenuOpen] = useState(true);
  const [isEmallMenuOpen, setIsEmallMenuOpen] = useState(true); // НОВОЕ: стейт для меню Emall
  const [isSalesMenuOpen, setIsSalesMenuOpen] = useState(true);
  const [isStockMenuOpen, setIsStockMenuOpen] = useState(true);
  
  const location = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isWbActive = ['/', '/catalog', '/reports', '/stocks', '/supplies-fbs'].includes(location.pathname);
  const isEmallActive = ['/emall-catalog'].includes(location.pathname); // НОВОЕ: проверка пути Emall
  const isSalesActive = ['/pos', '/orders-history'].includes(location.pathname);
  const isStockActive = ['/my-warehouse', '/suppliers', '/supplier-changes'].includes(location.pathname);

  const wbMenuItems = [
    { name: 'Каталог', icon: <Package size={18} />, path: '/catalog' },
    { name: 'Отчеты', icon: <BarChart3 size={18} />, path: '/reports' },
    { name: 'Остатки (FBS)', icon: <Layers size={18} />, path: '/stocks' },
    { name: 'Поставки (Сборка)', icon: <Truck size={18} />, path: '/supplies-fbs' },
  ];

  // НОВОЕ: Пункты меню для Emall
  const emallMenuItems = [
    { name: 'Каталог и связи', icon: <Package size={18} />, path: '/emall-catalog' },
    // Позже сюда добавим Отчеты и Заказы Emall
  ];

  const salesMenuItems = [
    { name: 'Касса (Отгрузка)', icon: <ShoppingCart size={18} />, path: '/pos' },
    { name: 'Архив продаж', icon: <Archive size={18} />, path: '/orders-history' },
  ];

  const stockMenuItems = [
    { name: 'Мой склад', icon: <Box size={18} />, path: '/my-warehouse' },
    { name: 'Поставщики', icon: <Truck size={18} />, path: '/suppliers' },
    { name: 'Изменения', icon: <History size={18} />, path: '/supplier-changes' },
  ];

  const handleExport = async () => {
    try {
      const allData: Record<string, any[]> = {};
      for (const table of db.tables) {
        allData[table.name] = await table.toArray();
      }
      
      const blob = new Blob([JSON.stringify(allData)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wb-analytics-backup-${new Date().toLocaleDateString('ru-RU')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Ошибка при экспорте данных');
      console.error(e);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        
        await db.transaction('rw', db.tables, async () => {
          for (const table of db.tables) {
            if (data[table.name]) {
              await table.clear();
              await table.bulkAdd(data[table.name]);
            }
          }
        });
        
        alert('Резервная копия успешно восстановлена!');
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert('Ошибка при чтении файла резервной копии. Убедитесь, что это правильный .json файл.');
      }
    };
    reader.readAsText(file);
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="w-64 bg-white border-r border-gray-200 h-screen flex flex-col">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg shadow-sm flex items-center justify-center">
          <span className="text-white font-bold">WB</span>
        </div>
        <span className="text-xl font-semibold text-gray-900 tracking-tight">Analytics</span>
      </div>

      <nav className="flex-1 px-4 mt-2 overflow-y-auto pb-4 space-y-4 scrollbar-hide">
        
        {/* === БЛОК WILDBERRIES === */}
        <div>
          <button onClick={() => setIsWbMenuOpen(!isWbMenuOpen)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-bold transition-colors cursor-pointer ${isWbActive && !isWbMenuOpen ? 'bg-blue-50 text-blue-700' : 'text-gray-800 hover:bg-gray-50'}`}>
            <div className="flex items-center gap-3">
              <Store size={20} className={isWbActive && !isWbMenuOpen ? "text-blue-600" : "text-gray-500"} />
              Wildberries
            </div>
            {isWbMenuOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
          <div className={`overflow-hidden transition-all duration-300 ${isWbMenuOpen ? 'max-h-64 mt-1 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="ml-4 pl-3 border-l-2 border-gray-100 space-y-1 py-1">
              {wbMenuItems.map((item) => (
                <NavLink key={item.name} to={item.path} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-[13px] transition-colors ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}>
                  {item.icon} {item.name}
                </NavLink>
              ))}
            </div>
          </div>
        </div>

        {/* === НОВЫЙ БЛОК EMALL === */}
        <div>
          <button onClick={() => setIsEmallMenuOpen(!isEmallMenuOpen)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-bold transition-colors cursor-pointer ${isEmallActive && !isEmallMenuOpen ? 'bg-purple-50 text-purple-700' : 'text-gray-800 hover:bg-gray-50'}`}>
            <div className="flex items-center gap-3">
              <ShoppingBag size={20} className={isEmallActive && !isEmallMenuOpen ? "text-purple-600" : "text-gray-500"} />
              Emall.by
            </div>
            {isEmallMenuOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
          <div className={`overflow-hidden transition-all duration-300 ${isEmallMenuOpen ? 'max-h-64 mt-1 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="ml-4 pl-3 border-l-2 border-gray-100 space-y-1 py-1">
              {emallMenuItems.map((item) => (
                <NavLink key={item.name} to={item.path} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-[13px] transition-colors ${isActive ? 'bg-purple-50 text-purple-700' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}>
                  {item.icon} {item.name}
                </NavLink>
              ))}
            </div>
          </div>
        </div>

        {/* === БЛОК ПРЯМЫЕ ПРОДАЖИ === */}
        <div>
          <button onClick={() => setIsSalesMenuOpen(!isSalesMenuOpen)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-bold transition-colors cursor-pointer ${isSalesActive && !isSalesMenuOpen ? 'bg-blue-50 text-blue-700' : 'text-gray-800 hover:bg-gray-50'}`}>
            <div className="flex items-center gap-3">
              <Briefcase size={20} className={isSalesActive && !isSalesMenuOpen ? "text-blue-600" : "text-gray-500"} />
              Прямые Продажи
            </div>
            {isSalesMenuOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
          <div className={`overflow-hidden transition-all duration-300 ${isSalesMenuOpen ? 'max-h-64 mt-1 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="ml-4 pl-3 border-l-2 border-gray-100 space-y-1 py-1">
              {salesMenuItems.map((item) => (
                <NavLink key={item.name} to={item.path} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-[13px] transition-colors ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}>
                  {item.icon} {item.name}
                </NavLink>
              ))}
            </div>
          </div>
        </div>

        {/* === БЛОК УЧЕТ СКЛАДА === */}
        <div>
          <button onClick={() => setIsStockMenuOpen(!isStockMenuOpen)} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-bold transition-colors cursor-pointer ${isStockActive && !isStockMenuOpen ? 'bg-blue-50 text-blue-700' : 'text-gray-800 hover:bg-gray-50'}`}>
            <div className="flex items-center gap-3">
              <Warehouse size={20} className={isStockActive && !isStockMenuOpen ? "text-blue-600" : "text-gray-500"} />
              Учет склада
            </div>
            {isStockMenuOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>
          <div className={`overflow-hidden transition-all duration-300 ${isStockMenuOpen ? 'max-h-64 mt-1 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="ml-4 pl-3 border-l-2 border-gray-100 space-y-1 py-1">
              {stockMenuItems.map((item) => (
                <NavLink key={item.name} to={item.path} className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-[13px] transition-colors ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'}`}>
                  {item.icon} {item.name}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      </nav>

      <div className="p-4 border-t border-gray-100 bg-gray-50/50">
        <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-3 px-2">Данные (Резерв)</h4>
        <div className="space-y-2">
          
          <button 
            onClick={() => SyncService.syncAllToServer()}
            className="w-full flex items-center gap-3 px-3 py-2 bg-white border border-green-200 rounded-lg text-[13px] font-bold text-green-700 hover:bg-green-50 hover:text-green-800 transition-colors shadow-sm"
          >
            <Save size={16} /> В папку (SQLite)
          </button>

          <button 
            onClick={handleExport}
            className="w-full flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg text-[13px] font-bold text-gray-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors shadow-sm"
          >
            <Download size={16} /> Скачать бэкап
          </button>
          
          <input type="file" accept=".json" ref={fileInputRef} onChange={handleImport} className="hidden" />
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 px-3 py-2 bg-white border border-gray-200 rounded-lg text-[13px] font-bold text-gray-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors shadow-sm"
          >
            <UploadCloud size={16} /> Восстановить
          </button>
        </div>
      </div>

    </div>
  );
}