import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Products from './pages/Products';
import Reports from './pages/Reports';
import PriceImport from './pages/PriceImport'; // Добавили импорт
import Stocks from './pages/Stocks';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen w-screen bg-[#F5F5F7] overflow-hidden font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Products />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/import" element={<PriceImport />} /> {/* Добавили маршрут */}
            <Route path="/stocks" element={<Stocks />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}