import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { TableManagement } from '../TableManagement';
import { AdminShell, DashboardOrderStatus, formatCfa, formatOrderDate, orderStatusLabels, type StaffRole } from './shared';

const withAuth = () => {
  const token = sessionStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const getStaffRole = (): StaffRole => {
  const role = sessionStorage.getItem('staffRole');
  return role === 'admin' ? 'admin' : 'manager';
};

const revenueGeneratingStatuses = new Set(['served', 'paid']);

function AdminDashboard() {
  const navigate = useNavigate();
  const [statPeriods, setStatPeriods] = useState<Record<string, string>>({
    'Chiffre d’affaires': 'day',
    Commandes: 'day',
    'Tables occupées': 'day',
  });
  const [stats, setStats] = useState([
    { label: 'Chiffre d’affaires', value: '0 XOF', accent: 'bg-emerald-50 text-emerald-700' },
    { label: 'Commandes', value: '0', accent: 'bg-amber-50 text-amber-700' },
    { label: 'Tables occupées', value: '0/0', accent: 'bg-violet-50 text-violet-700' },
    { label: 'Stock faible', value: '0', accent: 'bg-rose-50 text-rose-700' },
  ]);
  const [adminOrders, setAdminOrders] = useState<any[]>([]);
  const [tableOccupancy, setTableOccupancy] = useState({ occupied: 0, total: 0 });
  const adminDataRequestInProgress = useRef(false);

  const [orders, setOrders] = useState<any[]>([]);
  const [transitioningOrderId, setTransitioningOrderId] = useState<string | null>(null);
  const role = getStaffRole();

  useEffect(() => {
    const loadAdminData = async () => {
      if (adminDataRequestInProgress.current) return;
      adminDataRequestInProgress.current = true;
      try {
        const [ordersResponse, tablesResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/orders/`, { headers: withAuth() }),
          axios.get(`${API_BASE_URL}/tables/`, { headers: withAuth() }),
        ]);

        const backendOrders = Array.isArray(ordersResponse.data) ? ordersResponse.data : ordersResponse.data.results || [];
        const backendTables = Array.isArray(tablesResponse.data) ? tablesResponse.data : tablesResponse.data.results || [];
        setAdminOrders(backendOrders);

        if (backendOrders.length) {
          const recentOrders = backendOrders.slice().sort((orderA: any, orderB: any) => {
            const dateA = new Date(orderA.created_at || orderA.updated_at || 0).getTime();
            const dateB = new Date(orderB.created_at || orderB.updated_at || 0).getTime();
            return dateB - dateA || Number(orderB.id) - Number(orderA.id);
          }).slice(0, 5);
          setOrders(
            recentOrders.map((order: any) => ({
              id: `#${order.id}`,
              table: order.table ? `Table ${order.table}` : 'Table inconnue',
              status: orderStatusLabels[order.status] || order.status,
              statusCode: order.status,
              total: `${Number(order.total_amount || 0).toLocaleString('fr-FR')} XOF`,
              created_at: order.created_at,
              last_action_by_name: order.last_action_by_name,
            })),
          );
        }

        if (backendTables.length) {
          const occupied = backendTables.filter((table: any) => table.status === 'occupied').length;
          setTableOccupancy({ occupied, total: backendTables.length });
        } else {
          setTableOccupancy({ occupied: 0, total: 0 });
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          sessionStorage.removeItem('accessToken');
          sessionStorage.removeItem('refreshToken');
          sessionStorage.removeItem('staffRole');
          navigate('/login', { replace: true });
          return;
        }
        console.warn('Impossible de charger les données backend admin, utilisation des données locales.', error);
      } finally {
        adminDataRequestInProgress.current = false;
      }
    };

    void loadAdminData();
    const refreshTimer = window.setInterval(() => {
      void loadAdminData();
    }, 10000);

    return () => window.clearInterval(refreshTimer);
  }, [navigate]);

  const periodRange = (period: string) => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);

    if (period === 'week') {
      const day = start.getDay() || 7;
      start.setDate(start.getDate() - day + 1);
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 7);
    } else if (period === 'year') {
      start.setMonth(0, 1);
      end.setFullYear(start.getFullYear() + 1, 0, 1);
    } else {
      end.setDate(end.getDate() + 1);
    }

    return { start, end };
  };

  const ordersForPeriod = (period: string, getDate = (order: any) => order.created_at) => {
    const { start, end } = periodRange(period);
    return adminOrders.filter((order) => {
      const date = new Date(getDate(order));
      return !Number.isNaN(date.getTime()) && date >= start && date < end;
    });
  };

  const periodOrders = useMemo(() => ordersForPeriod(statPeriods.Commandes), [adminOrders, statPeriods.Commandes]);
  const revenueOrders = useMemo(
    () => ordersForPeriod(statPeriods['Chiffre d’affaires'], (order) => order.served_at || order.created_at)
      .filter((order) => revenueGeneratingStatuses.has(order.status)),
    [adminOrders, statPeriods['Chiffre d’affaires']],
  );
  const periodTableOrders = useMemo(() => ordersForPeriod(statPeriods['Tables occupées']), [adminOrders, statPeriods['Tables occupées']]);
  const periodOccupiedTables = new Set(
    periodTableOrders
      .map((order) => order.table)
      .filter((table) => table !== null && table !== undefined),
  ).size;

  const periodRevenue = revenueOrders.reduce((total, order) => total + Number(order.total_amount || 0), 0);
  const displayedStats = stats.map((stat) => {
    if (stat.label === 'Chiffre d’affaires') {
      return { ...stat, value: formatCfa(periodRevenue) };
    }
    if (stat.label === 'Commandes') {
      return { ...stat, value: `${periodOrders.length}` };
    }
    if (stat.label === 'Tables occupées') {
      const occupied = adminOrders.length ? periodOccupiedTables : tableOccupancy.occupied;
      return { ...stat, value: `${occupied}/${tableOccupancy.total}` };
    }
    return stat;
  });

  const orderTrend = useMemo(() => {
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return {
        key,
        label: date.toLocaleDateString('fr-FR', { weekday: 'short' }),
        dateLabel: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
        count: 0,
        amount: 0,
      };
    });
    const daysByKey = new Map(days.map((day) => [day.key, day]));

    adminOrders.forEach((order) => {
      const createdAt = new Date(order.created_at);
      if (Number.isNaN(createdAt.getTime())) return;
      const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}-${String(createdAt.getDate()).padStart(2, '0')}`;
      const day = daysByKey.get(key);
      if (day) day.count += 1;

      if (!revenueGeneratingStatuses.has(order.status)) return;
      const servedAt = new Date(order.served_at || order.created_at);
      if (Number.isNaN(servedAt.getTime())) return;
      const servedKey = `${servedAt.getFullYear()}-${String(servedAt.getMonth() + 1).padStart(2, '0')}-${String(servedAt.getDate()).padStart(2, '0')}`;
      const revenueDay = daysByKey.get(servedKey);
      if (revenueDay) revenueDay.amount += Number(order.total_amount || 0);
    });

    return days;
  }, [adminOrders]);
  const maxDailyAmount = Math.max(1, ...orderTrend.map((day) => day.amount));
  const trendLine = orderTrend.map((day, index) => {
    const x = 48 + index * 100;
    const y = 190 - (day.amount / maxDailyAmount) * 150;
    return `${x},${y}`;
  }).join(' ');
  const trendArea = `48,190 ${trendLine} 648,190`;
  const maxDailyOrders = Math.max(1, ...orderTrend.map((day) => day.count));

  const sendOrderToKitchen = async (orderId: string) => {
    setTransitioningOrderId(orderId);
    try {
      const response = await axios.post(`${API_BASE_URL}/orders/${orderId.replace('#', '')}/transition/`, {}, { headers: withAuth() });
      setOrders((current) => current.map((order) => order.id === orderId
        ? { ...order, status: orderStatusLabels[response.data.status] || response.data.status, statusCode: response.data.status }
        : order));
    } finally {
      setTransitioningOrderId(null);
    }
  };

  return (
    <AdminShell title="Dashboard">
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {displayedStats.map((stat, index) => (
            <div key={stat.label} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${stat.accent}`}>
                  {stat.label}
                </div>
                {index < 4 && (
                  <select
                    aria-label={`Période pour ${stat.label}`}
                    value={statPeriods[stat.label]}
                    onChange={(event) => setStatPeriods((current) => ({ ...current, [stat.label]: event.target.value }))}
                    className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  >
                    <option value="day">Jour</option>
                    <option value="week">Semaine</option>
                    <option value="year">Année</option>
                  </select>
                )}
              </div>
              <p className="mt-4 text-2xl font-bold text-slate-900">{stat.value}</p>
            </div>
          ))}
        </div>

        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Statistiques et évolution</h2>
              <p className="mt-1 text-sm text-slate-500">Activité quotidienne calculée à partir des commandes enregistrées.</p>
            </div>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">7 derniers jours</span>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold text-slate-800">Commandes par jour</h3>
                <span className="text-xs text-slate-500">{orderTrend.reduce((sum, day) => sum + day.count, 0)} au total</span>
              </div>
              <div className="mt-4 grid h-52 grid-cols-7 items-end gap-2" role="img" aria-label="Histogramme des commandes des sept derniers jours">
                {orderTrend.map((day) => (
                  <div key={day.key} className="flex h-full flex-col items-center justify-end gap-2">
                    <span className="text-xs font-semibold text-slate-600">{day.count}</span>
                    <div className="flex h-36 w-full items-end rounded-t-md bg-slate-50">
                      <div
                        className="w-full rounded-t-md bg-amber-400 transition-all"
                        style={{ height: `${day.count ? Math.max(8, (day.count / maxDailyOrders) * 100) : 0}%` }}
                        title={`${day.count} commande(s) le ${day.dateLabel}`}
                      />
                    </div>
                    <span className="text-[11px] capitalize text-slate-500">{day.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold text-slate-800">Montant des commandes</h3>
                <span className="text-xs text-slate-500">
                  {formatCfa(orderTrend.reduce((sum, day) => sum + day.amount, 0))}
                </span>
              </div>
              <svg viewBox="0 0 700 240" className="mt-3 h-48 w-full" role="img" aria-label="Courbe des montants des commandes des sept derniers jours">
                {[40, 90, 140, 190].map((y) => (
                  <line key={y} x1="48" y1={y} x2="648" y2={y} stroke="#e2e8f0" strokeDasharray="4 5" />
                ))}
                <polygon points={trendArea} fill="#f59e0b" fillOpacity="0.12" />
                <polyline points={trendLine} fill="none" stroke="#d97706" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {orderTrend.map((day, index) => {
                  const x = 48 + index * 100;
                  const y = 190 - (day.amount / maxDailyAmount) * 150;
                  return (
                    <g key={day.key}>
                      <circle cx={x} cy={y} r="5" fill="#d97706">
                        <title>{`${formatCfa(day.amount)} le ${day.dateLabel}`}</title>
                      </circle>
                      <text x={x} y="222" textAnchor="middle" fontSize="12" fill="#64748b">{day.label}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900">Commandes récentes</h2>
              <button
                type="button"
                onClick={() => navigate('/orders')}
                className="text-sm font-medium text-amber-600 hover:text-amber-700"
              >
                Voir tout
              </button>
            </div>
            <div className="data-scroll mt-4 max-h-[24rem] overflow-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 shadow-sm">
                  <tr>
                    <th className="px-4 py-3 font-medium">Commande</th>
                    <th className="px-4 py-3 font-medium">Table</th>
                    <th className="px-4 py-3 font-medium">Statut</th>
                    <th className="px-4 py-3 font-medium">Dernière action par</th>
                    <th className="px-4 py-3 font-medium">Total</th>
                    <th className="px-4 py-3 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-t border-slate-200">
                      <td className="px-4 py-3 font-medium">
                        <Link to={`/orders/${order.id.replace('#', '')}`} className="text-amber-700 hover:text-amber-900 hover:underline">
                          {order.id}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{order.table}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{order.last_action_by_name || 'Commande client'}</td>
                      <td className="px-4 py-3 font-semibold text-slate-900">{order.total}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatOrderDate(order.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <h2 className="text-xl font-bold text-slate-900">Alerte stock</h2>
            <ul className="data-scroll mt-4 max-h-[24rem] overflow-auto space-y-3 pr-1">
              {['Poulet', 'Tomates', 'Huile', 'Oignons'].map((item) => (
                <li key={item} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <span className="text-sm text-slate-700">{item}</span>
                  <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">Faible</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <DashboardOrderStatus role={role} />

        <TableManagement />
      </div>
    </AdminShell>
  );
}

export default AdminDashboard;
