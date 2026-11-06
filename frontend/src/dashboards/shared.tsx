import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import axios from 'axios';
import { Link, NavLink } from 'react-router-dom';
import { API_BASE_URL } from '../api';

export type StaffRole = 'admin' | 'manager' | 'cashier' | 'server' | 'cook' | 'stock_manager' | 'partner';

export const roleLabels: Record<StaffRole, string> = {
  admin: 'Administration',
  manager: 'Gérance',
  cashier: 'Caisse',
  server: 'Serveur(euse)',
  cook: 'Cuisine',
  stock_manager: 'Stocks / Approvisionnement',
  partner: 'Compte partenaire',
};

const withAuth = () => {
  const token = sessionStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const getStaffRole = (): StaffRole => {
  if (sessionStorage.getItem('adminViewRestaurantId')) return 'partner';
  const role = sessionStorage.getItem('staffRole');
  return role && role in roleLabels ? role as StaffRole : 'manager';
};

const getStaffDisplayName = () => {
  try {
    const user = JSON.parse(sessionStorage.getItem('staffUser') || 'null') as { username?: string; display_name?: string; first_name?: string; last_name?: string } | null;
    return user?.display_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Utilisateur';
  } catch {
    return 'Utilisateur';
  }
};

export const formatCfa = (value: number) => `${new Intl.NumberFormat('fr-FR').format(value)} XOF`;
export const formatOrderDate = (value?: string) => value
  ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
  : 'Date inconnue';

export function AdminShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [siteName, setSiteName] = useState('Restaurant');
  const [staffDisplayName, setStaffDisplayName] = useState(getStaffDisplayName());
  const [isNightMode, setIsNightMode] = useState(() => localStorage.getItem('restaurant-theme') === 'dark');
  const role = getStaffRole();
  const allNavItems = [
    { label: 'Dashboard', path: '/dashboard', icon: '📊' },
    { label: 'Tables', path: '/tables', icon: '🪑' },
    { label: 'QR Code', path: '/qr-display', icon: '📲' },
    { label: 'Menu', path: '/menu', icon: '🍽️' },
    { label: 'Commandes', path: '/orders', icon: '🧾' },
    { label: 'Cuisine', path: '/kitchen', icon: '👨‍🍳' },
    { label: 'Stocks', path: '/inventory', icon: '📦' },
    { label: 'Réservations', path: '/reservations', icon: '📅' },
    { label: 'Rapports', path: '/reports', icon: '📈' },
    { label: 'Configuration', path: '/configuration', icon: '⚙️' },
  ];
  const allowedPaths: Record<StaffRole, string[]> = {
    admin: allNavItems.map((item) => item.path),
    manager: allNavItems.map((item) => item.path),
    partner: ['/dashboard', '/tables', '/qr-display', '/menu', '/orders'],
    cashier: ['/dashboard', '/orders', '/qr-display'],
    server: ['/dashboard', '/tables', '/qr-display', '/orders', '/reservations'],
    cook: ['/dashboard', '/kitchen', '/orders', '/qr-display'],
    stock_manager: ['/dashboard', '/inventory', '/qr-display'],
  };
  const navItems = allNavItems.filter((item) => (
    sessionStorage.getItem('adminViewRestaurantId') || allowedPaths[role].includes(item.path)
  ));
  const firstName = staffDisplayName.split(' ')[0];

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/auth/me/`, { headers: withAuth() });
        if (!sessionStorage.getItem('adminViewRestaurantId')) {
          sessionStorage.setItem('staffUser', JSON.stringify(response.data));
        }
        setStaffDisplayName(response.data.display_name || response.data.username || 'Utilisateur');
      } catch {
        setStaffDisplayName(getStaffDisplayName());
      }
    };

    void loadCurrentUser();
  }, []);

  useEffect(() => {
    const loadSiteName = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/restaurants/`, { headers: withAuth() });
        const restaurants = Array.isArray(response.data) ? response.data : response.data.results || [];
        if (restaurants[0]?.name) setSiteName(restaurants[0].name);
      } catch {
        // Keep the fallback when the staff session expires during shell rendering.
      }
    };

    void loadSiteName();
  }, []);

  useEffect(() => {
    localStorage.setItem('restaurant-theme', isNightMode ? 'dark' : 'light');
  }, [isNightMode]);

  return (
    <div className={`admin-theme workspace-shell ${isNightMode ? 'admin-theme-dark' : ''}`}>
      <aside className="admin-sidebar workspace-sidebar">
        <Link to="/dashboard" className="workspace-brand">
          <span className="workspace-brand-mark" aria-hidden="true">R</span>
          <span>
            <span className="workspace-brand-name">{siteName}</span>
            <span className="workspace-brand-caption">{role === 'partner' ? 'Espace partenaire' : 'Restaurant Manager'}</span>
          </span>
        </Link>

        <p className="workspace-nav-caption">Espace de travail</p>
        <nav className="workspace-nav" aria-label="Navigation principale">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/dashboard'}
              className={({ isActive }) => `workspace-nav-link${isActive ? ' is-active' : ''}`}
            >
              <span className="workspace-nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="workspace-sidebar-footer">
          <span className="workspace-avatar" aria-hidden="true">{firstName.charAt(0).toUpperCase()}</span>
          <span className="workspace-user-copy">
            <strong>{staffDisplayName}</strong>
            <span>{roleLabels[role]}</span>
          </span>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="workspace-topbar">
          <div className="workspace-topbar-copy">
            <span className="workspace-status-dot" aria-hidden="true" />
            <span>Service opérationnel</span>
          </div>
          <div className="workspace-topbar-actions">
            <span className="workspace-user-mobile">{staffDisplayName}</span>
            <button
              type="button"
              onClick={() => setIsNightMode((current) => !current)}
              className="workspace-icon-button"
              aria-label={isNightMode ? 'Activer le mode jour' : 'Activer le mode nuit'}
              title={isNightMode ? 'Mode jour' : 'Mode nuit'}
            >
              {isNightMode ? '☀️' : '🌙'}
            </button>
          </div>
        </header>
        <main className="workspace-content">
          <header className="workspace-page-heading">
            <div>
              <p className="workspace-eyebrow">{siteName}</p>
              <h1>{title}</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link to="/menu" className="workspace-secondary-action">
                Gestion du menu
              </Link>
            </div>
          </header>
          {children}
        </main>
      </div>
    </div>
  );
}

export const orderStatusLabels: Record<string, string> = {
  pending: 'En attente du gérant',
  confirmed: 'Confirmée',
  preparing: 'En préparation',
  ready: 'Prête à servir',
  served: 'Client servi',
  paid: 'Payée',
  cancelled: 'Annulée',
  refused: 'Refusée',
};

const orderActionLabels: Record<string, string> = {
  manager: 'Envoyer à la cuisine',
  admin: 'Envoyer à la cuisine',
  partner: 'Envoyer à la cuisine',
  cook: 'Envoyer au serveur(euse)',
  server: 'Client servi',
};

const getOrderActionLabel = (role: StaffRole, status: string) => (
  role === 'cook' && status === 'confirmed' ? 'Démarrer la préparation' : orderActionLabels[role]
);

const activeOrderStatuses = new Set(['pending', 'confirmed', 'preparing', 'ready']);
const sortOrdersByActivity = (orders: any[]) => orders.slice().sort((orderA, orderB) => {
  const activeDifference = Number(activeOrderStatuses.has(orderB.status)) - Number(activeOrderStatuses.has(orderA.status));
  if (activeDifference !== 0) return activeDifference;
  const dateA = new Date(orderA.updated_at || orderA.created_at || 0).getTime();
  const dateB = new Date(orderB.updated_at || orderB.created_at || 0).getTime();
  return dateB - dateA || Number(orderB.id) - Number(orderA.id);
});

export function DashboardOrderStatus({ role }: { role: StaffRole }) {
  const [orders, setOrders] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [transitioningId, setTransitioningId] = useState<number | null>(null);
  const ordersRequestInProgress = useRef(false);

  const loadOrders = async () => {
    if (ordersRequestInProgress.current) return;
    ordersRequestInProgress.current = true;
    try {
      const response = await axios.get(`${API_BASE_URL}/orders/`, { headers: withAuth() });
      setOrders(Array.isArray(response.data) ? response.data : response.data.results || []);
      setError('');
    } catch (requestError) {
      console.error('Erreur lors du chargement des statuts des commandes.', requestError);
      setError('Impossible de charger les statuts des commandes.');
    } finally {
      ordersRequestInProgress.current = false;
    }
  };

  useEffect(() => {
    void loadOrders();
    const refreshTimer = window.setInterval(() => void loadOrders(), 10000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  const canTransition = (order: any) => (
    (role === 'manager' || role === 'admin' || role === 'partner') && order.status === 'pending'
  ) || (role === 'cook' && ['confirmed', 'preparing'].includes(order.status))
    || (role === 'server' && order.status === 'ready');

  const transitionOrder = async (order: any) => {
    setTransitioningId(order.id);
    try {
      await axios.post(`${API_BASE_URL}/orders/${order.id}/transition/`, {}, { headers: withAuth() });
      await loadOrders();
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.errors?.status?.[0]
        || requestError.response?.data?.message
        || requestError.response?.data?.detail
        || 'Impossible de mettre à jour cette commande.',
      );
    } finally {
      setTransitioningId(null);
    }
  };

  const statusIsGreen = (status: string) => ['ready', 'served', 'paid'].includes(status);
  const serviceLabel = role === 'cook' ? 'Cuisine' : role === 'server' ? 'Service' : 'Gérance';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-amber-600">Suivi opérationnel</p>
          <h3 className="mt-1 text-xl font-bold text-slate-900">Statut des commandes</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{serviceLabel}</span>
      </div>
      {error && <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="data-scroll mt-4 max-h-[24rem] overflow-auto space-y-3 pr-1">
        {orders.length === 0 ? <p className="text-sm text-slate-500">Aucune commande à afficher.</p> : sortOrdersByActivity(orders).slice(0, 8).map((order) => (
          <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
            <div>
              <Link to={`/orders/${order.id}`} className="font-semibold text-amber-700 hover:text-amber-900 hover:underline">
                Commande #{order.id}
              </Link>
              <p className="text-xs text-slate-500">{order.order_type === 'takeaway' ? 'À emporter' : order.table ? `Table ${order.table}` : 'Table inconnue'}</p>
              <p className="text-xs text-slate-500">Cuisiné par : <span className="font-semibold text-slate-700">{order.cooked_by_name || 'Pas encore cuisiné'}</span></p>
              <p className="text-xs text-slate-400">{formatOrderDate(order.created_at)}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusIsGreen(order.status) ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                {orderStatusLabels[order.status] || order.status}
              </span>
              {canTransition(order) && (
                <button
                  type="button"
                  disabled={transitioningId === order.id}
                  onClick={() => void transitionOrder(order)}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {transitioningId === order.id ? 'Mise à jour...' : getOrderActionLabel(role, order.status)}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
