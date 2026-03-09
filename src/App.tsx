import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Products from './pages/Products';
import Reports from './pages/Reports';
import PriceImport from './pages/PriceImport'; 
import Stocks from './pages/Stocks';
import WbSupplies from './pages/WbSupplies';
import MyWarehouse from './pages/MyWarehouse';
import Suppliers from './pages/Suppliers'; 
import SupplierChanges from './pages/SupplierChanges';
import PosTerminal from './pages/PosTerminal';
import OrdersHistory from './pages/OrdersHistory';
import EmallCatalog from './pages/EmallCatalog';

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen w-screen bg-[#F5F5F7] overflow-hidden font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/catalog" replace />} />
            <Route path="/catalog" element={<Products />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/import" element={<PriceImport />} />
            <Route path="/stocks" element={<Stocks />} />
            
            {/* Новые маршруты склада */}
            <Route path="/my-warehouse" element={<MyWarehouse />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/supplier-changes" element={<SupplierChanges />} />
            <Route path="/supplies-fbs" element={<WbSupplies />} />
            <Route path="/pos" element={<PosTerminal />} />
            <Route path="/orders-history" element={<OrdersHistory />} />
            <Route path="/emall-catalog" element={<EmallCatalog />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}