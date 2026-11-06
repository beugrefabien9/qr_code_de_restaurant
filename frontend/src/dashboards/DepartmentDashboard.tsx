import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_BASE_URL } from '../api';
import { AdminShell, DashboardOrderStatus, roleLabels, type StaffRole } from './shared';

const withAuth = () => {
  const token = sessionStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

type DepartmentRole = Exclude<StaffRole, 'admin' | 'manager' | 'partner'>;

const departmentDashboardConfig: Record<DepartmentRole, {
  title: string;
  description: string;
  actions: { label: string; detail: string; path: string; accent: string }[];
}> = {
  cashier: {
    title: 'Dashboard Caisse',
    description: 'Suivez les commandes à encaisser et les opérations de paiement.',
    actions: [
      { label: 'Commandes à traiter', detail: 'Consulter les commandes et leurs montants.', path: '/orders', accent: 'bg-amber-50 text-amber-700' },
      { label: 'Menu client', detail: 'Vérifier les articles visibles par les clients.', path: '/menu', accent: 'bg-emerald-50 text-emerald-700' },
    ],
  },
  server: {
    title: 'Dashboard Service',
    description: 'Gérez les tables, les QR codes et le suivi des commandes en salle.',
    actions: [
      { label: 'Tables en salle', detail: 'Voir l’état et la capacité des tables.', path: '/tables', accent: 'bg-sky-50 text-sky-700' },
      { label: 'QR des tables', detail: 'Afficher le QR code à remettre aux clients.', path: '/qr-display', accent: 'bg-amber-50 text-amber-700' },
      { label: 'Commandes à servir', detail: 'Suivre les commandes reçues en salle.', path: '/orders', accent: 'bg-emerald-50 text-emerald-700' },
    ],
  },
  cook: {
    title: 'Dashboard Cuisine',
    description: 'Concentrez-vous sur les commandes à préparer et leur progression.',
    actions: [
      { label: 'Commandes en cuisine', detail: 'Voir les commandes et leurs statuts.', path: '/kitchen', accent: 'bg-rose-50 text-rose-700' },
      { label: 'Détail des commandes', detail: 'Consulter les articles et les remarques clients.', path: '/orders', accent: 'bg-amber-50 text-amber-700' },
    ],
  },
  stock_manager: {
    title: 'Dashboard Stocks',
    description: 'Surveillez les niveaux de stock et les mouvements d’approvisionnement.',
    actions: [
      { label: 'Stocks actuels', detail: 'Contrôler les seuils et les produits faibles.', path: '/inventory', accent: 'bg-rose-50 text-rose-700' },
      { label: 'Produits du menu', detail: 'Gérer la disponibilité des plats.', path: '/inventory', accent: 'bg-emerald-50 text-emerald-700' },
    ],
  },
};

function DepartmentDashboard({ role }: { role: DepartmentRole }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [tables, setTables] = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<any[]>([]);
  const roleDataRequestInProgress = useRef(false);

  useEffect(() => {
    const loadRoleData = async () => {
      if (roleDataRequestInProgress.current) return;
      roleDataRequestInProgress.current = true;
      try {
        const requests: Promise<any>[] = [axios.get(`${API_BASE_URL}/orders/`, { headers: withAuth() })];
        if (role === 'server') requests.push(axios.get(`${API_BASE_URL}/tables/`, { headers: withAuth() }));
        if (role === 'stock_manager') requests.push(axios.get(`${API_BASE_URL}/ingredients/`, { headers: withAuth() }));

        const responses = await Promise.all(requests);
        const normalize = (data: any) => Array.isArray(data) ? data : data.results || [];
        setOrders(normalize(responses[0].data));
        if (role === 'server') setTables(normalize(responses[1]?.data));
        if (role === 'stock_manager') setIngredients(normalize(responses[1]?.data));
      } catch {
        setOrders([]);
        setTables([]);
        setIngredients([]);
      } finally {
        roleDataRequestInProgress.current = false;
      }
    };

    void loadRoleData();
    const refreshTimer = window.setInterval(() => void loadRoleData(), 10000);
    return () => window.clearInterval(refreshTimer);
  }, [role]);


  const dashboard = departmentDashboardConfig[role];
  const roleStats = role === 'cashier'
    ? [
      { label: 'Commandes en attente', value: orders.filter((order) => order.status === 'pending').length, accent: 'bg-amber-50 text-amber-700' },
      { label: 'Commandes servies', value: orders.filter((order) => order.status === 'served').length, accent: 'bg-emerald-50 text-emerald-700' },
    ]
    : role === 'server'
      ? [
        { label: 'Tables occupées', value: tables.filter((table) => table.status === 'occupied').length, accent: 'bg-sky-50 text-sky-700' },
        { label: 'Commandes prêtes', value: orders.filter((order) => order.status === 'ready').length, accent: 'bg-amber-50 text-amber-700' },
      ]
      : role === 'cook'
        ? [
          { label: 'À préparer', value: orders.filter((order) => order.status === 'preparing').length, accent: 'bg-rose-50 text-rose-700' },
          { label: 'Envoyées au service', value: orders.filter((order) => order.status === 'ready').length, accent: 'bg-emerald-50 text-emerald-700' },
        ]
        : [
          { label: 'Stocks faibles', value: ingredients.filter((ingredient) => ingredient.is_low_stock).length, accent: 'bg-rose-50 text-rose-700' },
          { label: 'Mouvements récents', value: ingredients.length, accent: 'bg-emerald-50 text-emerald-700' },
        ];

  return (
    <AdminShell title={dashboard.title}>
      <div className="space-y-6">
        <div className="rounded-2xl bg-slate-900 p-5 text-white">
          <p className="text-xs uppercase tracking-[0.28em] text-amber-300">{roleLabels[role]}</p>
          <h2 className="mt-2 text-2xl font-bold">Bonjour, votre espace est prêt</h2>
          <p className="mt-2 text-sm text-slate-300">{dashboard.description}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {roleStats.map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${stat.accent}`}>{stat.label}</span>
              <p className="mt-4 text-3xl font-bold text-slate-900">{stat.value}</p>
            </div>
          ))}
        </div>

        <DashboardOrderStatus role={role} />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {dashboard.actions.map((action) => (
            <button
              key={`${action.path}-${action.label}`}
              type="button"
              onClick={() => navigate(action.path)}
              className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${action.accent}`}>
                {roleLabels[role]}
              </span>
              <h3 className="mt-4 text-lg font-bold text-slate-900">{action.label}</h3>
              <p className="mt-2 text-sm text-slate-500">{action.detail}</p>
              <span className="mt-5 inline-block text-sm font-semibold text-amber-600">Ouvrir →</span>
            </button>
          ))}
        </div>
      </div>
    </AdminShell>
  );
}

export default DepartmentDashboard;
