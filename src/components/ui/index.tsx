import React from 'react';
import { Search } from 'lucide-react';

// Главная обертка страницы (серый фон, отступы)
export const PageLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="p-6 w-full h-full flex flex-col bg-[#F5F5F7] gap-4 relative">
    {children}
  </div>
);

// Верхняя панель управления (белая плашка)
export const Toolbar = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex-shrink-0 relative z-40">
    {children}
  </div>
);

// Стандартный поиск
export const SearchInput = ({ value, onChange, placeholder = "Поиск..." }: { value: string, onChange: (val: string) => void, placeholder?: string }) => (
  <div className="relative w-80">
    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
    <input 
      type="text" 
      placeholder={placeholder} 
      value={value} 
      onChange={(e) => onChange(e.target.value)} 
      className="w-full bg-gray-50 border border-gray-200 rounded-lg py-2 pl-9 pr-3 text-[13px] font-medium focus:ring-1 focus:ring-blue-500 outline-none transition-all" 
    />
  </div>
);

// Единые стили кнопок
export const Button = ({ children, variant = 'primary', onClick, disabled, className = '' }: any) => {
  const base = "flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-bold transition-colors shadow-sm disabled:opacity-50 cursor-pointer ";
  const variants: any = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 border border-transparent",
    outline: "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 border",
    success: "bg-green-50 text-green-700 border-green-200 hover:bg-green-100 border",
    danger: "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 border",
    ghost: "bg-transparent text-gray-500 hover:text-blue-600 hover:bg-blue-50 shadow-none border border-transparent"
  };
  return (
    <button onClick={onClick} disabled={disabled} className={base + variants[variant] + ' ' + className}>
      {children}
    </button>
  );
};

// Обертка для таблицы
export const TableWrapper = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex-1 flex flex-col overflow-hidden relative">
    {children}
  </div>
);

// Пустое состояние
export const EmptyState = ({ icon: Icon, title, description }: any) => (
  <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
    <Icon size={40} className="text-gray-300 mb-4" />
    <h3 className="text-xl font-semibold text-gray-900">{title}</h3>
    <p className="text-[14px] text-gray-500 mt-1">{description}</p>
  </div>
);