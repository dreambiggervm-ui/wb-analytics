import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Package, BarChart3, Layers, ChevronDown, ChevronRight, Store, Warehouse, Box, Truck, History } from 'lucide-react';

export default function Sidebar() {
  const [isWbMenuOpen, setIsWbMenuOpen] = useState(true);
  const [isStockMenuOpen, setIsStockMenuOpen] = useState(true); // Состояние меню Склада
  const location = useLocation();

  const isWbActive = ['/', '/catalog', '/reports', '/stocks'].includes(location.pathname);
  const isStockActive = ['/my-warehouse', '/suppliers', '/supplier-changes'].includes(location.pathname);

  const wbMenuItems = [
    { name: 'Каталог', icon: <Package size={18} />, path: '/catalog' },
    { name: 'Отчеты', icon: <BarChart3 size={18} />, path: '/reports' },
    { name: 'Остатки (FBS)', icon: <Layers size={18} />, path: '/stocks' },
  ];

  const stockMenuItems = [
    { name: 'Мой склад', icon: <Box size={18} />, path: '/my-warehouse' },
    { name: 'Поставщики', icon: <Truck size={18} />, path: '/suppliers' },
    { name: 'Изменения', icon: <History size={18} />, path: '/supplier-changes' },
  ];

  return (
    <div className="w-64 bg-white border-r border-gray-200 h-screen flex flex-col">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg shadow-sm flex items-center justify-center">
          <span className="text-white font-bold">WB</span>
        </div>
        <span className="text-xl font-semibold text-gray-900 tracking-tight">Analytics</span>
      </div>

      <nav className="flex-1 px-4 mt-2 overflow-y-auto pb-4 space-y-4">
        
        {/* Категория: Wildberries */}
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

        {/* Категория: Склад (Новая) */}
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
    </div>
  );
}