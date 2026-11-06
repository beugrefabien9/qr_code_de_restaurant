import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { QRCodeCanvas } from 'qrcode.react';
import { API_BASE_URL } from '../api';
import { AdminShell, formatCfa, formatOrderDate, orderStatusLabels } from './shared';

const withAuth = () => {
  const token = sessionStorage.getItem('accessToken');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

type PartnerOrder = {
  id: number;
  status: string;
  total_amount: number;
  created_at: string;
};

type PartnerTable = {
  id: number;
  number: string | number;
  status: string;
  qr_code: string | null;
};

type PartnerProduct = {
  id: number;
  name: string;
  is_active: boolean;
  is_available: boolean;
};

type PartnerDashboardData = {
  restaurantName: string;
  orders: PartnerOrder[];
  tables: PartnerTable[];
  products: PartnerProduct[];
};

const responseItems = <T,>(data: T[] | { results?: T[] }) => (
  Array.isArray(data) ? data : data.results || []
);

function PartnerDashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<PartnerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authExpired, setAuthExpired] = useState(false);
  const configuredQrHost = import.meta.env.VITE_PUBLIC_FRONTEND_HOST?.trim();
  const qrHost = configuredQrHost || window.location.host;
  const menuUrlFor = (table: PartnerTable) => table.qr_code
    ? `${window.location.protocol}//${qrHost}/restaurant/menu/${table.qr_code}?table=${table.number}`
    : '';

  useEffect(() => {
    const loadPartnerDashboard = async () => {
      try {
        const [userResponse, ordersResponse, tablesResponse, productsResponse] = await Promise.all([
          axios.get<{ restaurant?: { name?: string } }>(`${API_BASE_URL}/auth/me/`, { headers: withAuth() }),
          axios.get<PartnerOrder[] | { results?: PartnerOrder[] }>(`${API_BASE_URL}/orders/`, { headers: withAuth() }),
          axios.get<PartnerTable[] | { results?: PartnerTable[] }>(`${API_BASE_URL}/tables/`, { headers: withAuth() }),
          axios.get<PartnerProduct[] | { results?: PartnerProduct[] }>(`${API_BASE_URL}/products/`, { headers: withAuth() }),
        ]);

        setData({
          restaurantName: userResponse.data.restaurant?.name || 'votre restaurant',
          orders: responseItems(ordersResponse.data),
          tables: responseItems(tablesResponse.data),
          products: responseItems(productsResponse.data),
        });
        setError('');
      } catch (requestError) {
        const unauthorized = axios.isAxiosError(requestError) && requestError.response?.status === 401;
        setAuthExpired(unauthorized);
        const message = axios.isAxiosError<{ message?: string }>(requestError)
          ? requestError.response?.data?.message
          : undefined;
        setError(unauthorized
          ? 'Votre session partenaire doit être renouvelée. Reconnectez-vous pour retrouver votre espace.'
          : message || 'Impossible de charger les données de votre restaurant. Veuillez réessayer.');
      } finally {
        setLoading(false);
      }
    };

    void loadPartnerDashboard();
  }, []);

  const pendingOrders = data?.orders.filter((order) => ['pending', 'preparing', 'ready'].includes(order.status)).length || 0;
  const occupiedTables = data?.tables.filter((table) => table.status === 'occupied').length || 0;
  const menuProducts = data?.products.filter((product) => product.is_active && product.is_available).length || 0;
  const recentOrders = data?.orders.slice().sort((first, second) => (
    new Date(second.created_at).getTime() - new Date(first.created_at).getTime()
  )).slice(0, 5) || [];
  const quickActions = [
    { label: 'Gérer le menu', detail: 'Ajoutez vos plats et mettez à jour leurs disponibilités.', path: '/menu', icon: '🍽️' },
    { label: 'Suivre les commandes', detail: 'Consultez les commandes et leur état de préparation.', path: '/orders', icon: '🧾' },
    { label: 'Gérer les tables', detail: 'Organisez vos tables et leurs QR codes.', path: '/tables', icon: '🪑' },
    { label: 'Afficher les QR codes', detail: 'Téléchargez ou imprimez le QR de chaque table.', path: '/qr-display', icon: '▦' },
  ];

  return (
    <AdminShell title="Tableau de bord">
      <div className="partner-dashboard">
        <section className="partner-welcome">
          <div>
            <p className="partner-section-kicker">VOTRE ESPACE PARTENAIRE</p>
            <h2>{data?.restaurantName || 'Votre restaurant'}</h2>
            <p>Votre activité et les outils essentiels de votre établissement, réunis au même endroit.</p>
          </div>
          <div className="partner-welcome-mark" aria-hidden="true">✦</div>
        </section>

        {error && (
          <div role="alert" className="partner-dashboard-alert">
            {error}
            {authExpired && (
              <button type="button" onClick={() => navigate('/login', { state: { returnTo: '/dashboard' } })}>
                Se reconnecter
              </button>
            )}
          </div>
        )}

        <section aria-label="Statistiques du restaurant" className="partner-stats-grid">
          {[
            { label: 'Commandes enregistrées', value: data?.orders.length || 0, icon: '🧾', detail: 'Toutes vos commandes' },
            { label: 'À traiter', value: pendingOrders, icon: '◷', detail: 'Demandent votre attention' },
            { label: 'Tables occupées', value: `${occupiedTables}/${data?.tables.length || 0}`, icon: '◉', detail: 'Occupation actuelle' },
            { label: 'Plats disponibles', value: menuProducts, icon: '✦', detail: 'Visibles sur votre menu' },
          ].map((stat) => (
            <div key={stat.label} className="partner-stat-card">
              <span className="partner-stat-icon" aria-hidden="true">{stat.icon}</span>
              <span className="partner-stat-label">{stat.label}</span>
              <p className="partner-stat-value">{loading ? '…' : stat.value}</p>
              <span className="partner-stat-detail">{stat.detail}</span>
            </div>
          ))}
        </section>

        <section>
          <div className="partner-section-heading">
            <div>
              <p className="partner-section-kicker">ACCÈS RAPIDE</p>
              <h2>Gestion de votre restaurant</h2>
            </div>
          </div>
          <div className="partner-actions-grid">
            {quickActions.map((action) => (
              <button
                key={action.path}
                type="button"
                onClick={() => navigate(action.path)}
                className="partner-action-card"
              >
                <span className="partner-action-icon" aria-hidden="true">{action.icon}</span>
                <span className="partner-action-title">{action.label}</span>
                <span className="partner-action-detail">{action.detail}</span>
                <span className="partner-action-link">Ouvrir <span aria-hidden="true">→</span></span>
              </button>
            ))}
          </div>
        </section>

        <section className="partner-qr-section">
          <div className="partner-section-heading">
            <div>
              <p className="partner-section-kicker">PRÊTS POUR VOS CLIENTS</p>
              <h2>QR codes de vos tables</h2>
              <p>Scannez pour vérifier le lien du menu ou ouvrez l’affichage complet pour imprimer.</p>
            </div>
            <button type="button" onClick={() => navigate('/qr-display')} className="partner-section-link">
              Tous les QR codes <span aria-hidden="true">→</span>
            </button>
          </div>
          {loading ? <p className="partner-empty-state">Chargement des tables…</p> : data?.tables.length ? (
            <div className="partner-qr-grid">
              {data.tables.slice(0, 4).map((table) => {
                const menuUrl = menuUrlFor(table);
                return (
                  <button
                    key={table.id}
                    type="button"
                    className="partner-qr-card"
                    onClick={() => navigate(`/qr-display?table=${table.id}`)}
                    aria-label={`Afficher le QR code de la table ${table.number}`}
                  >
                    <span className="partner-qr-preview">
                      {menuUrl ? <QRCodeCanvas value={menuUrl} size={116} level="H" includeMargin /> : <span>QR indisponible</span>}
                    </span>
                    <span className="partner-qr-table">Table {table.number}</span>
                    <span className="partner-qr-status">{table.status === 'occupied' ? 'Occupée' : table.status === 'reserved' ? 'Réservée' : 'Libre'}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="partner-empty-state">Aucune table n’est encore configurée. Ajoutez vos tables pour générer leurs QR codes.</p>
          )}
          {data?.tables.length && data.tables.length > 4 ? (
            <button type="button" onClick={() => navigate('/qr-display')} className="partner-more-link">
              Afficher les {data.tables.length - 4} autres tables
            </button>
          ) : null}
          {['localhost', '127.0.0.1'].includes(window.location.hostname) && !configuredQrHost && (
            <p className="partner-qr-warning">Pour que vos clients puissent scanner les QR codes avec leur téléphone, ouvrez le site avec l’adresse réseau du PC.</p>
          )}
        </section>

        <section className="partner-orders-section">
          <div className="partner-section-heading">
            <div>
              <p className="partner-section-kicker">SUIVI EN TEMPS RÉEL</p>
              <h2>Commandes récentes</h2>
            </div>
            <button type="button" onClick={() => navigate('/orders')} className="partner-section-link">Toutes les commandes <span aria-hidden="true">→</span></button>
          </div>
          {loading ? <p className="partner-empty-state">Chargement des commandes…</p> : recentOrders.length ? (
            <ul className="partner-order-list">
              {recentOrders.map((order) => (
                <li key={order.id}>
                  <div>
                    <strong>Commande #{order.id}</strong>
                    <span>{formatOrderDate(order.created_at)}</span>
                  </div>
                  <div className="partner-order-total">
                    <strong>{formatCfa(order.total_amount)}</strong>
                    <span>{orderStatusLabels[order.status] || order.status}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className="partner-empty-state">Aucune commande pour le moment.</p>}
        </section>
      </div>
    </AdminShell>
  );
}

export default PartnerDashboard;
