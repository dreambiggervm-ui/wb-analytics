import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Products from './pages/Products';
import Reports from './pages/Reports';
import PriceImport from './pages/PriceImport'; 
import Stocks from './pages/Stocks';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen w-screen bg-[#F5F5F7] overflow-hidden font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            {/* Автоматически перенаправляем с главной страницы в каталог */}
            <Route path="/" element={<Navigate to="/catalog" replace />} />
            <Route path="/catalog" element={<Products />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/import" element={<PriceImport />} />
            <Route path="/stocks" element={<Stocks />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}