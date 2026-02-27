import { NavLink } from 'react-router-dom';
import { Package, FileText, BarChart3, Upload, Layers } from 'lucide-react'; // добавили Upload

export default function Sidebar() {
  const menuItems = [
    { name: 'Каталог', icon: <Package size={20} />, path: '/' },
    { name: 'Загрузка цен', icon: <Upload size={20} />, path: '/import' }, // Новая кнопка!
    { name: 'Отчеты', icon: <BarChart3 size={20} />, path: '/reports' },
    { name: 'Остатки (FBS)', icon: <Layers size={20} />, path: '/stocks' },
  ];

  return (
    <div className="w-64 bg-white border-r border-gray-200 h-screen flex flex-col">
      {/* Логотип */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-blue-500 rounded-lg shadow-sm flex items-center justify-center">
          <span className="text-white font-bold">WB</span>
        </div>
        <span className="text-xl font-semibold text-gray-900 tracking-tight">Analytics</span>
      </div>

      {/* Кнопки меню */}
      <nav className="flex-1 px-4 space-y-1 mt-4">
        {menuItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium transition-colors ${
                isActive 
                  ? 'bg-gray-100 text-blue-600' 
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            {item.icon}
            {item.name}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}