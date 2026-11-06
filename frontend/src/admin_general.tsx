import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './api';
import MenuManagement from './MenuManagement';

type RestaurantStatus = 'pending' | 'active' | 'rejected' | 'suspended';
type AdminSection = 'overview' | 'restaurants' | 'menus';
type PartnerPanel = 'details' | 'edit' | 'activity' | 'subscription';

type RestaurantSummary = {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  status: RestaurantStatus;
  suspension_reason: string | null;
  suspended_at: string | null;
  created_at: string;
  partner?: { name: string; email: string } | null;
  users?: { id: number; name: string; email: string; role: string; created_at: string }[];
  users_count: number;
  tables_count: number;
  products_count: number;
  orders_count: number;
};

type DashboardData = {
  restaurants: { total: number; active: number; pending: number; rejected: number; suspended: number };
  users: { staff: number; customers: number | null };
  orders: { total: number; today: number; gross_revenue: number };
  subscriptions: { active: number | null; expired: number | null; revenue: number | null };
  trend: { date: string; orders: number; revenue: number }[];
  recent_restaurants: Pick<RestaurantSummary, 'id' | 'name' | 'email' | 'status' | 'created_at' | 'partner'>[];
};

type PaginatedRestaurants = {
  data: RestaurantSummary[];
  current_page: number;
  last_page: number;
  total: number;
};

type PartnerActivity = {
  id: number;
  action: string;
  actor?: { name: string } | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const statusLabels: Record<RestaurantStatus, string> = {
  pending: 'En attente',
  active: 'Actif',
  rejected: 'Refusé',
  suspended: 'Suspendu',
};

const statusStyles: Record<RestaurantStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  suspended: 'bg-slate-200 text-slate-700',
};

const formatNumber = (value: number) => new Intl.NumberFormat('fr-FR').format(value);
const formatMoney = (value: number) => `${formatNumber(value)} XOF`;
const formatDate = (value: string) => new Date(value).toLocaleDateString('fr-FR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const accessHeaders = () => ({
  Authorization: `Bearer ${sessionStorage.getItem('accessToken') || ''}`,
});

function MetricCard({ label, value, detail, accent }: {
  label: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
      <p className={`mt-2 text-xs font-semibold ${accent}`}>{detail}</p>
    </article>
  );
}

function TrendChart({ trend }: { trend: DashboardData['trend'] }) {
  const maximumOrders = Math.max(1, ...trend.map((item) => item.orders));
  const maximumRevenue = Math.max(1, ...trend.map((item) => item.revenue));

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Activité des 7 derniers jours</h2>
          <p className="mt-1 text-sm text-slate-500">Commandes et chiffre d’affaires brut des commandes servies/payées.</p>
        </div>
        <div className="flex gap-4 text-xs font-medium text-slate-600">
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />Commandes</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />Ventes</span>
        </div>
      </div>
      <div className="mt-6 grid h-48 grid-cols-7 items-end gap-3" role="img" aria-label="Graphique des commandes quotidiennes">
        {trend.map((day) => {
          const orderHeight = Math.max(4, (day.orders / maximumOrders) * 100);
          const revenueHeight = Math.max(4, (day.revenue / maximumRevenue) * 100);
          return (
            <div key={day.date} className="flex h-full flex-col items-center justify-end gap-2">
              <div className="flex h-36 w-full items-end justify-center gap-1">
                <div
                  className="w-3 rounded-t bg-amber-500 sm:w-5"
                  style={{ height: `${day.orders ? orderHeight : 2}%` }}
                  title={`${day.orders} commande(s)`}
                />
                <div
                  className="w-3 rounded-t bg-emerald-500 sm:w-5"
                  style={{ height: `${day.revenue ? revenueHeight : 2}%` }}
                  title={formatMoney(day.revenue)}
                />
              </div>
              <span className="text-[11px] text-slate-500">
                {new Date(`${day.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function AdminGeneralDashboard() {
  const navigate = useNavigate();
  const [section, setSection] = useState<AdminSection>(() => {
    const requestedSection = new URLSearchParams(window.location.search).get('section');
    return requestedSection === 'restaurants' || requestedSection === 'menus' ? requestedSection : 'overview';
  });
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [restaurants, setRestaurants] = useState<PaginatedRestaurants | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updatingRestaurantId, setUpdatingRestaurantId] = useState<number | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<RestaurantSummary | null>(null);
  const [partnerPanel, setPartnerPanel] = useState<PartnerPanel>('details');
  const [partnerActivity, setPartnerActivity] = useState<PartnerActivity[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [savingPartner, setSavingPartner] = useState(false);
  const [partnerForm, setPartnerForm] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
    partner_name: '',
    partner_email: '',
  });

  const loadDashboard = useCallback(async () => {
    try {
      const response = await axios.get<DashboardData>(`${API_BASE_URL}/admin/dashboard`, {
        headers: accessHeaders(),
      });
      setDashboard(response.data);
    } catch (requestError) {
      console.error('Impossible de charger le tableau de bord administrateur général.', requestError);
      setError('Les statistiques de la plateforme ne peuvent pas être chargées.');
    } finally {
      setLoadingDashboard(false);
    }
  }, []);

  const loadRestaurants = useCallback(async () => {
    setLoadingRestaurants(true);
    try {
      const response = await axios.get<PaginatedRestaurants>(`${API_BASE_URL}/admin/restaurants`, {
        headers: accessHeaders(),
        params: {
          search: search.trim() || undefined,
          status: statusFilter || undefined,
          page,
        },
      });
      setRestaurants(response.data);
    } catch (requestError) {
      console.error('Impossible de charger les restaurants partenaires.', requestError);
      setError('La liste des partenaires ne peut pas être chargée.');
    } finally {
      setLoadingRestaurants(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (section === 'restaurants') void loadRestaurants();
  }, [loadRestaurants, section]);

  const changeRestaurantStatus = async (restaurant: RestaurantSummary, status: RestaurantStatus) => {
    const action = status === 'active'
      ? 'activer'
      : status === 'rejected'
        ? 'refuser'
        : 'suspendre';
    if (!window.confirm(`Confirmer l’action « ${action} » pour ${restaurant.name} ?`)) return;
    const reason = status === 'suspended'
      ? window.prompt(`Raison de la suspension de ${restaurant.name} :`)?.trim()
      : undefined;
    if (status === 'suspended' && !reason) {
      setError('Une raison est obligatoire pour suspendre un partenaire.');
      return;
    }

    setUpdatingRestaurantId(restaurant.id);
    setError('');
    setNotice('');
    try {
      await axios.patch(
        `${API_BASE_URL}/admin/restaurants/${restaurant.id}/status`,
        { status, ...(reason ? { reason } : {}) },
        { headers: accessHeaders() },
      );
      setSelectedPartner((current) => current?.id === restaurant.id
        ? {
          ...current,
          status,
          suspension_reason: status === 'suspended' ? reason || null : null,
          suspended_at: status === 'suspended' ? new Date().toISOString() : null,
        }
        : current);
      setNotice(`${restaurant.name} : statut « ${statusLabels[status]} » enregistré.`);
      await Promise.all([loadDashboard(), loadRestaurants()]);
    } catch (requestError) {
      console.error('Impossible de modifier le statut du restaurant.', requestError);
      setError(axios.isAxiosError<{ message?: string }>(requestError)
        ? requestError.response?.data?.message || 'Le statut du restaurant ne peut pas être modifié.'
        : 'Le statut du restaurant ne peut pas être modifié.');
    } finally {
      setUpdatingRestaurantId(null);
    }
  };

  const openPartnerPanel = async (restaurant: RestaurantSummary, panel: PartnerPanel) => {
    setSelectedPartner(restaurant);
    setPartnerPanel(panel);
    setError('');
    setPartnerActivity([]);

    try {
      const response = await axios.get<RestaurantSummary>(`${API_BASE_URL}/admin/restaurants/${restaurant.id}`, {
        headers: accessHeaders(),
      });
      setSelectedPartner(response.data);
      setPartnerForm({
        name: response.data.name,
        address: response.data.address || '',
        phone: response.data.phone || '',
        email: response.data.email || '',
        partner_name: response.data.partner?.name || '',
        partner_email: response.data.partner?.email || '',
      });
    } catch (requestError) {
      console.error('Impossible de charger la fiche du partenaire.', requestError);
      setError('La fiche du partenaire ne peut pas être chargée.');
    }

    if (panel === 'activity') {
      setLoadingActivity(true);
      try {
        const response = await axios.get<{ data: PartnerActivity[] }>(
          `${API_BASE_URL}/admin/restaurants/${restaurant.id}/activity`,
          { headers: accessHeaders() },
        );
        setPartnerActivity(response.data.data);
      } catch (requestError) {
        console.error('Impossible de charger l’historique du partenaire.', requestError);
        setError('L’historique du partenaire ne peut pas être chargé.');
      } finally {
        setLoadingActivity(false);
      }
    }
  };

  const openPartnerDashboard = async (restaurant: RestaurantSummary) => {
    setError('');
    try {
      await axios.get(`${API_BASE_URL}/admin/restaurants/${restaurant.id}/view`, {
        headers: accessHeaders(),
      });
      sessionStorage.setItem('adminViewRestaurantId', String(restaurant.id));
      sessionStorage.setItem('adminViewRestaurantName', restaurant.name);
      navigate('/admin/partner-view');
    } catch (requestError) {
      console.error('Impossible d’ouvrir l’espace partenaire en consultation.', requestError);
      setError(axios.isAxiosError<{ message?: string }>(requestError)
        ? requestError.response?.data?.message || 'Le tableau de bord partenaire ne peut pas être ouvert.'
        : 'Serveur inaccessible. Le tableau de bord partenaire ne peut pas être ouvert.');
    }
  };

  const savePartner = async () => {
    if (!selectedPartner) return;
    setSavingPartner(true);
    setError('');
    setNotice('');
    try {
      const response = await axios.patch<RestaurantSummary>(
        `${API_BASE_URL}/admin/restaurants/${selectedPartner.id}`,
        {
          ...partnerForm,
          email: partnerForm.email || null,
          address: partnerForm.address || null,
          phone: partnerForm.phone || null,
        },
        { headers: accessHeaders() },
      );
      setSelectedPartner(response.data);
      setPartnerPanel('details');
      setNotice('Les informations du partenaire ont été mises à jour.');
      await loadRestaurants();
    } catch (requestError) {
      console.error('Impossible de modifier les informations du partenaire.', requestError);
      setError(axios.isAxiosError<{ message?: string }>(requestError)
        ? requestError.response?.data?.message || 'Les informations du partenaire ne peuvent pas être modifiées.'
        : 'Les informations du partenaire ne peuvent pas être modifiées.');
    } finally {
      setSavingPartner(false);
    }
  };

  const openSubscriptionPanel = async (restaurant: RestaurantSummary) => {
    setSelectedPartner(restaurant);
    setPartnerPanel('subscription');
    setError('');
    try {
      await axios.post(
        `${API_BASE_URL}/admin/restaurants/${restaurant.id}/consult`,
        { section: 'subscription' },
        { headers: accessHeaders() },
      );
    } catch (requestError) {
      console.error('Impossible de journaliser la consultation de l’abonnement.', requestError);
      setError('La consultation de l’abonnement ne peut pas être journalisée.');
    }
  };

  const statusTabs = [
    { value: '', label: 'Tous' },
    { value: 'pending', label: 'En attente' },
    { value: 'active', label: 'Actifs' },
    { value: 'suspended', label: 'Partenaires suspendus' },
    { value: 'rejected', label: 'Refusés' },
  ];

  const navigation: { id: AdminSection; label: string; icon: string }[] = [
    { id: 'overview', label: 'Vue générale', icon: '◫' },
    { id: 'restaurants', label: 'Partenaires', icon: '▦' },
    { id: 'menus', label: 'Menus', icon: '☷' },
  ];

  return (
    <div className="admin-general-shell">
      <div className="admin-general-layout">
        <aside className="admin-general-sidebar">
          <div className="admin-general-brand">
            <span className="workspace-brand-mark" aria-hidden="true">R</span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-300">Plateforme SaaS</p>
              <h1 className="mt-2 text-xl font-bold">Administration générale</h1>
              <p className="mt-1 text-sm text-slate-400">Supervision de la plateforme</p>
            </div>
          </div>
          <nav className="admin-general-nav" aria-label="Navigation administrateur général">
            {navigation.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setSection(item.id); setError(''); setNotice(''); }}
                aria-current={section === item.id ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${
                  section === item.id ? 'bg-amber-500 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="mt-8 hidden rounded-2xl border border-slate-800 bg-slate-900 p-4 md:block">
            <p className="text-xs uppercase tracking-wider text-slate-400">Données disponibles</p>
            <p className="mt-2 text-sm text-slate-300">Les statistiques affichées proviennent de la base de données.</p>
          </div>
        </aside>

        <main className="admin-general-main">
          <header className="admin-general-header">
            <div>
              <p className="text-sm font-medium text-amber-700">Espace propriétaire</p>
              <h2 className="mt-1 text-2xl font-bold text-slate-950">
                {section === 'overview' ? 'Vue générale' : section === 'menus' ? 'Menus de la plateforme' : 'Restaurants partenaires'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => { void loadDashboard(); if (section === 'restaurants') void loadRestaurants(); }}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              Actualiser
            </button>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem('accessToken');
                sessionStorage.removeItem('refreshToken');
                sessionStorage.removeItem('staffRole');
                sessionStorage.removeItem('staffUser');
                navigate('/login', { replace: true });
              }}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Déconnexion
            </button>
          </header>

          {error && <p role="alert" className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
          {notice && <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{notice}</p>}

          {section === 'overview' ? (
            loadingDashboard && !dashboard ? (
              <p className="rounded-xl bg-white p-6 text-slate-500">Chargement des statistiques…</p>
            ) : dashboard && (
              <div className="space-y-6">
                <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <MetricCard label="Restaurants inscrits" value={formatNumber(dashboard.restaurants.total)} detail={`${formatNumber(dashboard.restaurants.active)} actifs`} accent="text-emerald-700" />
                  <MetricCard label="En attente de validation" value={formatNumber(dashboard.restaurants.pending)} detail="Demandes à examiner" accent="text-amber-700" />
                  <MetricCard label="Restaurants suspendus" value={formatNumber(dashboard.restaurants.suspended)} detail={`${formatNumber(dashboard.restaurants.rejected)} demandes refusées`} accent="text-slate-600" />
                  <MetricCard label="Commandes enregistrées" value={formatNumber(dashboard.orders.total)} detail={`${formatNumber(dashboard.orders.today)} aujourd’hui`} accent="text-sky-700" />
                  <MetricCard label="Ventes brutes des commandes" value={formatMoney(dashboard.orders.gross_revenue)} detail="Commandes servies ou payées — tous restaurants" accent="text-emerald-700" />
                  <MetricCard label="Comptes employés" value={formatNumber(dashboard.users.staff)} detail="Comptes liés à un restaurant" accent="text-violet-700" />
                </section>

                <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
                  <TrendChart trend={dashboard.trend} />
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900">Derniers partenaires</h2>
                        <p className="mt-1 text-sm text-slate-500">Inscriptions les plus récentes</p>
                      </div>
                      <button type="button" onClick={() => setSection('restaurants')} className="text-sm font-semibold text-amber-700 hover:text-amber-900">
                        Tout voir
                      </button>
                    </div>
                    <ul className="mt-4 divide-y divide-slate-100">
                      {dashboard.recent_restaurants.map((restaurant) => (
                        <li key={restaurant.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">{restaurant.name}</p>
                            <p className="truncate text-xs text-slate-500">{restaurant.partner?.name || restaurant.email || 'Contact non renseigné'}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[restaurant.status]}`}>
                            {statusLabels[restaurant.status]}
                          </span>
                        </li>
                      ))}
                      {dashboard.recent_restaurants.length === 0 && <li className="py-6 text-sm text-slate-500">Aucun partenaire inscrit.</li>}
                    </ul>
                  </section>
                </div>

                <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5">
                  <h2 className="font-bold text-slate-800">Indicateurs à ajouter avec les prochains modules</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Le nombre de clients et les revenus/états d’abonnement ne sont pas encore enregistrés par le système.
                    Ils apparaîtront lorsque les comptes clients et les abonnements seront ajoutés; aucune valeur estimée n’est affichée.
                  </p>
                </section>
              </div>
            )
          ) : section === 'menus' ? (
            <MenuManagement isGlobalAdmin />
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-4 sm:p-5">
                <div>
                  <h3 className="font-bold text-slate-900">Partenaires</h3>
                  <p className="mt-1 text-sm text-slate-500">{restaurants?.total ?? 0} restaurant(s)</p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                  <input
                    value={search}
                    onChange={(event) => { setSearch(event.target.value); setPage(1); }}
                    placeholder="Rechercher un restaurant…"
                    aria-label="Rechercher un restaurant"
                    className="min-w-0 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-amber-500 sm:w-64"
                  />
                  <select
                    value={statusFilter}
                    onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}
                    aria-label="Filtrer par statut"
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
                  >
                    <option value="">Tous les statuts</option>
                    {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto border-b border-slate-100 px-4 py-3 sm:px-5">
                {statusTabs.map((tab) => (
                  <button
                    key={tab.value || 'all'}
                    type="button"
                    onClick={() => { setStatusFilter(tab.value); setPage(1); }}
                    aria-pressed={statusFilter === tab.value}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                      statusFilter === tab.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {loadingRestaurants && !restaurants ? (
                <p className="p-6 text-sm text-slate-500">Chargement des partenaires…</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-[850px] w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-5 py-3 font-semibold">Restaurant</th>
                          <th className="px-5 py-3 font-semibold">Responsable</th>
                          <th className="px-5 py-3 font-semibold">Inscription</th>
                          <th className="px-5 py-3 font-semibold">Données</th>
                          <th className="px-5 py-3 font-semibold">Statut</th>
                          <th className="px-5 py-3 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {restaurants?.data.map((restaurant) => (
                          <tr key={restaurant.id}>
                            <td className="px-5 py-4">
                              <button
                                type="button"
                                onClick={() => void openPartnerDashboard(restaurant)}
                                className="text-left font-semibold text-amber-800 hover:text-amber-950 hover:underline"
                              >
                                {restaurant.name}
                              </button>
                              <p className="mt-1 text-xs text-slate-500">{restaurant.email || 'E-mail non renseigné'}</p>
                            </td>
                            <td className="px-5 py-4">
                              <p className="text-slate-800">{restaurant.partner?.name || '—'}</p>
                              <p className="mt-1 text-xs text-slate-500">{restaurant.partner?.email || '—'}</p>
                            </td>
                            <td className="px-5 py-4 whitespace-nowrap text-slate-600">{formatDate(restaurant.created_at)}</td>
                            <td className="px-5 py-4 whitespace-nowrap text-xs text-slate-600">
                              {restaurant.orders_count} cmd. · {restaurant.products_count} plats · {restaurant.tables_count} tables
                            </td>
                            <td className="px-5 py-4">
                              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[restaurant.status]}`}>
                                {statusLabels[restaurant.status]}
                              </span>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex max-w-64 flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void openPartnerDashboard(restaurant)}
                                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                                >
                                  Voir le tableau de bord
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void openPartnerPanel(restaurant, 'details')}
                                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Fiche
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void openPartnerPanel(restaurant, 'edit')}
                                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Modifier
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void openPartnerPanel(restaurant, 'activity')}
                                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Historique
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void openSubscriptionPanel(restaurant)}
                                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  Abonnement
                                </button>
                                {restaurant.status !== 'active' && (
                                  <button
                                    type="button"
                                    disabled={updatingRestaurantId === restaurant.id}
                                    onClick={() => void changeRestaurantStatus(restaurant, 'active')}
                                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                  >
                                    {restaurant.status === 'pending' ? 'Valider' : 'Réactiver'}
                                  </button>
                                )}
                                {restaurant.status === 'pending' && (
                                  <button
                                    type="button"
                                    disabled={updatingRestaurantId === restaurant.id}
                                    onClick={() => void changeRestaurantStatus(restaurant, 'rejected')}
                                    className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                                  >
                                    Refuser
                                  </button>
                                )}
                                {restaurant.status === 'active' && (
                                  <button
                                    type="button"
                                    disabled={updatingRestaurantId === restaurant.id}
                                    onClick={() => void changeRestaurantStatus(restaurant, 'suspended')}
                                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                  >
                                    Suspendre
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {restaurants?.data.length === 0 && (
                          <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">Aucun restaurant ne correspond à cette recherche.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-4">
                    <p className="text-xs text-slate-500">Page {restaurants?.current_page || 1} sur {restaurants?.last_page || 1}</p>
                    <div className="flex gap-2">
                      <button type="button" disabled={!restaurants || restaurants.current_page <= 1 || loadingRestaurants} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40">Précédent</button>
                      <button type="button" disabled={!restaurants || restaurants.current_page >= restaurants.last_page || loadingRestaurants} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40">Suivant</button>
                    </div>
                  </div>
                </>
              )}
            </section>
          )}
        </main>
        {selectedPartner && (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-5"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedPartner(null);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="partner-panel-title"
              className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7"
            >
              <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">Fiche partenaire</p>
                  <h2 id="partner-panel-title" className="mt-1 text-2xl font-bold text-slate-950">{selectedPartner.name}</h2>
                  <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyles[selectedPartner.status]}`}>
                    {statusLabels[selectedPartner.status]}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPartner(null)}
                  aria-label="Fermer la fiche partenaire"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Fermer
                </button>
              </header>

              <div className="mt-5 flex flex-wrap gap-2 border-b border-slate-200 pb-4">
                {([
                  ['details', 'Informations'],
                  ['edit', 'Modifier'],
                  ['activity', 'Historique'],
                  ['subscription', 'Abonnement'],
                ] as const).map(([panel, label]) => (
                  <button
                    key={panel}
                    type="button"
                    onClick={() => {
                      setPartnerPanel(panel);
                      if (panel === 'activity') void openPartnerPanel(selectedPartner, panel);
                      if (panel === 'subscription') void openSubscriptionPanel(selectedPartner);
                    }}
                    aria-pressed={partnerPanel === panel}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                      partnerPanel === panel ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void openPartnerDashboard(selectedPartner)}
                  className="ml-auto rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-white hover:bg-amber-600"
                >
                  Voir le tableau de bord
                </button>
              </div>

              {partnerPanel === 'details' && (
                <div className="mt-5 space-y-5">
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div><dt className="text-xs font-semibold uppercase text-slate-500">E-mail restaurant</dt><dd className="mt-1 text-sm text-slate-900">{selectedPartner.email || 'Non renseigné'}</dd></div>
                    <div><dt className="text-xs font-semibold uppercase text-slate-500">Adresse</dt><dd className="mt-1 text-sm text-slate-900">{selectedPartner.address || 'Non renseignée'}</dd></div>
                    <div><dt className="text-xs font-semibold uppercase text-slate-500">Téléphone</dt><dd className="mt-1 text-sm text-slate-900">{selectedPartner.phone || 'Non renseigné'}</dd></div>
                    <div><dt className="text-xs font-semibold uppercase text-slate-500">Responsable</dt><dd className="mt-1 text-sm text-slate-900">{selectedPartner.partner?.name || 'Non renseigné'}</dd></div>
                    <div><dt className="text-xs font-semibold uppercase text-slate-500">E-mail responsable</dt><dd className="mt-1 text-sm text-slate-900">{selectedPartner.partner?.email || 'Non renseigné'}</dd></div>
                    <div><dt className="text-xs font-semibold uppercase text-slate-500">Inscription</dt><dd className="mt-1 text-sm text-slate-900">{formatDate(selectedPartner.created_at)}</dd></div>
                  </dl>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Commandes', selectedPartner.orders_count],
                      ['Produits', selectedPartner.products_count],
                      ['Tables', selectedPartner.tables_count],
                      ['Utilisateurs', selectedPartner.users_count],
                    ].map(([label, count]) => (
                      <div key={label} className="rounded-xl bg-slate-50 p-3">
                        <p className="text-xs text-slate-500">{label}</p>
                        <p className="mt-1 text-lg font-bold text-slate-900">{count}</p>
                      </div>
                    ))}
                  </div>
                  {selectedPartner.users && (
                    <section>
                      <h3 className="font-semibold text-slate-900">Comptes et employés</h3>
                      <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
                        {selectedPartner.users.map((user) => (
                          <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                            <div>
                              <p className="text-sm font-medium text-slate-800">{user.name}</p>
                              <p className="text-xs text-slate-500">{user.email}</p>
                            </div>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{user.role}</span>
                          </li>
                        ))}
                        {selectedPartner.users.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">Aucun utilisateur associé.</li>}
                      </ul>
                    </section>
                  )}
                  {selectedPartner.status === 'suspended' && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                      <h3 className="font-semibold text-rose-900">Suspension du restaurant</h3>
                      <p className="mt-2 text-sm text-rose-800"><strong>Raison :</strong> {selectedPartner.suspension_reason || 'Aucune raison enregistrée.'}</p>
                      <p className="mt-1 text-sm text-rose-800"><strong>Date :</strong> {selectedPartner.suspended_at ? new Date(selectedPartner.suspended_at).toLocaleString('fr-FR') : 'Non renseignée'}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {selectedPartner.status === 'active' ? (
                      <button type="button" onClick={() => void changeRestaurantStatus(selectedPartner, 'suspended')} className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-800 hover:bg-rose-50">Suspendre</button>
                    ) : (
                      <button type="button" onClick={() => void changeRestaurantStatus(selectedPartner, 'active')} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Réactiver</button>
                    )}
                    <button type="button" onClick={() => { setPartnerPanel('activity'); void openPartnerPanel(selectedPartner, 'activity'); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Consulter l’historique</button>
                    <button type="button" onClick={() => void openSubscriptionPanel(selectedPartner)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Consulter l’abonnement</button>
                  </div>
                </div>
              )}

              {partnerPanel === 'edit' && (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {([
                    ['name', 'Nom du restaurant', 'text'],
                    ['email', 'E-mail du restaurant', 'email'],
                    ['address', 'Adresse', 'text'],
                    ['phone', 'Téléphone', 'tel'],
                    ['partner_name', 'Nom du responsable', 'text'],
                    ['partner_email', 'E-mail du responsable', 'email'],
                  ] as const).map(([field, label, type]) => (
                    <label key={field} className="block text-sm font-medium text-slate-700">
                      {label}
                      <input
                        type={type}
                        value={partnerForm[field]}
                        onChange={(event) => setPartnerForm((current) => ({ ...current, [field]: event.target.value }))}
                        className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-amber-500"
                      />
                    </label>
                  ))}
                  <div className="flex gap-2 sm:col-span-2">
                    <button type="button" onClick={() => void savePartner()} disabled={savingPartner} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                      {savingPartner ? 'Enregistrement…' : 'Enregistrer'}
                    </button>
                    <button type="button" onClick={() => setPartnerPanel('details')} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">Annuler</button>
                  </div>
                </div>
              )}

              {partnerPanel === 'activity' && (
                <div className="mt-5">
                  {loadingActivity ? (
                    <p className="text-sm text-slate-500">Chargement de l’historique…</p>
                  ) : partnerActivity.length ? (
                    <ol className="divide-y divide-slate-100">
                      {partnerActivity.map((item) => (
                        <li key={item.id} className="py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-slate-800">{item.action.replace(/\./g, ' ')}</p>
                            <time className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString('fr-FR')}</time>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">Par {item.actor?.name || 'Système'}</p>
                          {typeof item.metadata?.reason === 'string' && <p className="mt-1 text-sm text-slate-600">Raison : {item.metadata.reason}</p>}
                          {typeof item.metadata?.from === 'string' && typeof item.metadata?.to === 'string' && (
                            <p className="mt-1 text-xs text-slate-500">Statut : {item.metadata.from} → {item.metadata.to}</p>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-slate-500">Aucune activité enregistrée pour ce partenaire.</p>
                  )}
                </div>
              )}

              {partnerPanel === 'subscription' && (
                <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5">
                  <h3 className="font-semibold text-slate-900">Abonnement du partenaire</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    La gestion des forfaits et abonnements n’est pas encore disponible dans le système. La consultation a été inscrite au journal d’activité.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}