import AdminGeneralDashboard from '../admin_general';
import ManagerDashboard from './ManagerDashboard';
import PartnerDashboard from './PartnerDashboard';
import CashierDashboard from './CashierDashboard';
import ServerDashboard from './ServerDashboard';
import CookDashboard from './CookDashboard';
import StockManagerDashboard from './StockManagerDashboard';

export default function DashboardRouter() {
  if (sessionStorage.getItem('adminViewRestaurantId')) return <PartnerDashboard />;
  const role = sessionStorage.getItem('staffRole');
  switch (role) {
    case 'admin': return <AdminGeneralDashboard />;
    case 'manager': return <ManagerDashboard />;
    case 'partner': return <PartnerDashboard />;
    case 'cashier': return <CashierDashboard />;
    case 'server': return <ServerDashboard />;
    case 'cook': return <CookDashboard />;
    case 'stock_manager': return <StockManagerDashboard />;
    default: return <ManagerDashboard />;
  }
}
