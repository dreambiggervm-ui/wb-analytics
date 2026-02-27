import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Package, BarChart3, Layers, ChevronDown, ChevronRight, Store } from 'lucide-react';

export default function Sidebar() {
  // Состояние для открытия/закрытия меню WB (по умолчанию открыто)
  const [isWbMenuOpen, setIsWbMenuOpen] = useState(true);
  const location = useLocation();

  // Проверяем, находимся ли мы сейчас внутри раздела WB
  const isWbActive = ['/', '/catalog', '/reports', '/stocks'].includes(location.pathname);

  // Наши подкатегории
  const wbMenuItems = [
    { name: 'Каталог', icon: <Package size={18} />, path: '/catalog' },
    { name: 'Отчеты', icon: <BarChart3 size={18} />, path: '/reports' },
    { name: 'Остатки (FBS)', icon: <Layers size={18} />, path: '/stocks' },
  ];

  return (
    <div className="w-64 bg-white border-r border-gray-200 h-screen flex flex-col">
      {/* Логотип */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-600 rounded-lg shadow-sm flex items-center justify-center">
          <span className="text-white font-bold">WB</span>
        </div>
        <span className="text-xl font-semibold text-gray-900 tracking-tight">Analytics</span>
      </div>

      {/* Навигация */}
      <nav className="flex-1 px-4 mt-2">
        
        {/* Главная категория: Wildberries */}
        <div>
          <button 
            onClick={() => setIsWbMenuOpen(!isWbMenuOpen)}
            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl font-bold transition-colors cursor-pointer ${
              isWbActive && !isWbMenuOpen ? 'bg-blue-50 text-blue-700' : 'text-gray-800 hover:bg-gray-50'
            }`}
          >
            <div className="flex items-center gap-3">
              <Store size={20} className={isWbActive && !isWbMenuOpen ? "text-blue-600" : "text-gray-500"} />
              Wildberries
            </div>
            {isWbMenuOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
          </button>

          {/* Выпадающий список с плавной анимацией */}
          <div className={`overflow-hidden transition-all duration-300 ${isWbMenuOpen ? 'max-h-64 mt-1 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="ml-4 pl-3 border-l-2 border-gray-100 space-y-1 py-1">
              {wbMenuItems.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-[13px] transition-colors ${
                      isActive 
                        ? 'bg-blue-50 text-blue-700' 
                        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                    }`
                  }
                >
                  {item.icon}
                  {item.name}
                </NavLink>
              ))}
            </div>
          </div>
        </div>

      </nav>
    </div>
  );
}