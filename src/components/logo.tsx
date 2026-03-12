import React from 'react';
import { Package, TrendingUp } from 'lucide-react';

interface LogoProps {
  className?: string;
  collapsed?: boolean;
}

export const MBoxLogo: React.FC<LogoProps> = ({ className = '', collapsed = false }) => {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Иконка логотипа в синих тонах */}
      <div className="relative flex items-center justify-center min-w-[40px] w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-500/30 transition-transform hover:scale-105 duration-200">
        <Package className="w-6 h-6 text-white absolute opacity-60" strokeWidth={1.5} />
        <TrendingUp className="w-5 h-5 text-white absolute mt-1 ml-1" strokeWidth={2.5} />
      </div>

      {/* Текстовая часть */}
      {!collapsed && (
        <div className="flex flex-col animate-fade-in">
          <span className="text-xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-blue-700 to-cyan-600 dark:from-blue-400 dark:to-cyan-300 leading-none">
            MBox
          </span>
          <span className="text-[10px] font-semibold tracking-widest text-slate-500 uppercase mt-0.5 leading-none">
            ERP System
          </span>
        </div>
      )}
    </div>
  );
};