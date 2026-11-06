import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import axios from 'axios';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from './api';
import HomeQRPage from './HomeQRPage';
import QRScannerPage from './qrScanner';
import AdminQRDisplayPage from './adminQRDisplay';
import { TableManagement } from './TableManagement';
import { AdminShell } from './dashboards/shared';
import DashboardRouter from './dashboards/DashboardRouter';
import AdminGeneralDashboard from './admin_general';
import MenuManagement from './MenuManagement';

const FRONTEND_BASE_URL = `${window.location.protocol}//${window.location.host}`;
const getToken = () => sessionStorage.getItem('accessToken');
const getRefreshToken = () => sessionStorage.getItem('refreshToken');
let accessTokenRefresh: Promise<string> | null = null;

const refreshAccessToken = (refreshToken: string) => {
  if (!accessTokenRefresh) {
    accessTokenRefresh = axios.post(`${API_BASE_URL}/auth/token/refresh/`, { refresh: refreshToken })
      .then((response) => {
        sessionStorage.setItem('accessToken', response.data.access);
        sessionStorage.setItem('refreshToken', response.data.refresh);
        return response.data.access as string;
      })
      .catch((refreshError) => {
        if (getRefreshToken() === refreshToken) {
          sessionStorage.removeItem('accessToken');
          sessionStorage.removeItem('refreshToken');
          sessionStorage.removeItem('staffRole');
          sessionStorage.removeItem('staffUser');
        }
        return Promise.reject(refreshError);
      })
      .finally(() => {
        accessTokenRefresh = null;
      });
  }

  return accessTokenRefresh;
};
const getStaffUser = () => {
  try {
    return JSON.parse(sessionStorage.getItem('staffUser') || 'null') as { username?: string; display_name?: string; first_name?: string; last_name?: string } | null;
  } catch {
    return null;
  }
};
const getStaffDisplayName = () => {
  const user = getStaffUser();
  return user?.display_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'Utilisateur';
};

const withAuth = () => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

axios.interceptors.request.use((request) => {
  const token = getToken();
  if (token) request.headers.Authorization = `Bearer ${token}`;
  const viewRestaurantId = sessionStorage.getItem('adminViewRestaurantId');
  if (viewRestaurantId) request.headers['X-Admin-View-Restaurant'] = viewRestaurantId;
  return request;
});

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const request = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const refreshToken = getRefreshToken();

    if (error.response?.status !== 401 || !request || request._retry || !refreshToken || request.url?.includes('/auth/token')) {
      return Promise.reject(error);
    }

    request._retry = true;
    try {
      const accessToken = await refreshAccessToken(refreshToken);
      request.headers = { ...request.headers, Authorization: `Bearer ${accessToken}` };
      return axios(request);
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
  },
);

type Product = {
  id: number;
  name: string;
  category: string;
  description: string;
  price: number;
  prepTime: string;
  badge: string;
  availableQuantity: number;
  image_url?: string | null;
  created_at?: string;
};

type CartItem = Product & {
  quantity: number;
  note?: string;
};

const formatCfa = (value: number) => `${new Intl.NumberFormat('fr-FR').format(value)} XOF`;
const productImageUrl = (imageUrl?: string | null) => imageUrl
  ? new URL(imageUrl, window.location.origin).toString()
  : '';
const formatOrderDate = (value?: string) => value
  ? new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
  : 'Date inconnue';
const sortProductsByAddedDate = <T extends { id: number | string; created_at?: string }>(items: T[]) => items.slice().sort((productA, productB) => {
  const dateA = new Date(productA.created_at || 0).getTime();
  const dateB = new Date(productB.created_at || 0).getTime();
  return dateB - dateA || Number(productB.id) - Number(productA.id);
});
const cartStorageKey = (token: string | undefined) => `restaurant-cart-${token || 'unknown'}`;
const menuCacheKey = (token: string) => `restaurant-menu-${token}`;

type StaffRole = 'admin' | 'manager' | 'cashier' | 'server' | 'cook' | 'stock_manager' | 'partner';

const roleLabels: Record<StaffRole, string> = {
  admin: 'Administration',
  manager: 'Gérance',
  cashier: 'Caisse',
  server: 'Serveur(euse)',
  cook: 'Cuisine',
  stock_manager: 'Stocks / Approvisionnement',
  partner: 'Compte partenaire',
};

const tableStatusLabels: Record<string, string> = {
  free: 'Libre',
  occupied: 'Occupée',
  reserved: 'Réservée',
  unavailable: 'Indisponible',
};

const getStaffRole = (): StaffRole => {
  const role = sessionStorage.getItem('staffRole');
  return role && role in roleLabels ? role as StaffRole : 'manager';
};

const configurableFeatures = [
  { key: 'qr_ordering', label: 'Commande par QR code', description: 'Permettre aux clients de consulter le menu et commander depuis leur table.' },
  { key: 'reservations', label: 'Réservations', description: 'Activer la gestion des réservations de tables.' },
  { key: 'inventory', label: 'Gestion des stocks', description: 'Afficher le suivi des stocks et les alertes de seuil.' },
  { key: 'kitchen', label: 'Espace cuisine', description: 'Afficher les commandes à préparer pour la cuisine.' },
  { key: 'reports', label: 'Rapports et statistiques', description: 'Activer les indicateurs et rapports du restaurant.' },
];

function ClientMenuPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedCategory, setSelectedCategory] = useState('Tous');
  const [restaurantName, setRestaurantName] = useState('Menu du restaurant');
  const qrTableNumber = searchParams.get('table');
  const [tableLabel, setTableLabel] = useState(qrTableNumber ? `Table ${qrTableNumber}` : 'Table inconnue');
  const [menuItems, setMenuItems] = useState<Product[]>([]);
  const [menuLoadError, setMenuLoadError] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const cartRef = useRef<HTMLElement | null>(null);
  const [isNightMode, setIsNightMode] = useState(() => localStorage.getItem('restaurant-theme') === 'dark');

  useEffect(() => {
    localStorage.setItem('restaurant-theme', isNightMode ? 'dark' : 'light');
  }, [isNightMode]);

  useEffect(() => {
    if (!token) return;

    const applyMenuData = (data: any) => {
      const { restaurant, table, products: apiProducts } = data;

      if (restaurant?.name) setRestaurantName(restaurant.name);
      if (table?.number) setTableLabel(`Table ${table.number}`);
      setMenuItems(
        (Array.isArray(apiProducts) ? apiProducts : []).map((item: any) => ({
          id: item.id,
          name: item.name,
          category: item.category_name || 'Plats',
          description: item.description,
          price: Number(item.price),
          prepTime: `${item.preparation_time || 10} min`,
          badge: 'À la carte',
          availableQuantity: Number(item.available_quantity ?? 0),
          image_url: item.image_url || null,
          created_at: item.created_at,
        })),
      );
    };

    try {
      const cachedMenu = localStorage.getItem(menuCacheKey(token));
      if (cachedMenu) applyMenuData(JSON.parse(cachedMenu));
    } catch {
      localStorage.removeItem(menuCacheKey(token));
    }

    let active = true;
    let refreshTimer: number | undefined;

    const loadMenu = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/public/menu/${token}/`);
        localStorage.setItem(menuCacheKey(token), JSON.stringify(response.data));
        if (active) {
          applyMenuData(response.data);
          setMenuLoadError('');
        }
      } catch (error) {
        console.warn('Impossible de charger le menu backend.', error);
        if (active) {
          setMenuItems([]);
          setTableLabel('Table inconnue');
          if (axios.isAxiosError(error) && error.response?.data?.detail) {
            setMenuLoadError(error.response.data.detail);
          } else {
            setMenuLoadError('Le menu ne peut pas être chargé. Vérifiez la connexion au serveur puis rechargez la page.');
          }
        }
      } finally {
        if (active) refreshTimer = window.setTimeout(() => void loadMenu(), 2000);
      }
    };

    void loadMenu();

    return () => {
      active = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [token]);

  const visibleProducts = useMemo(
    () =>
      selectedCategory === 'Tous'
        ? sortProductsByAddedDate(menuItems).filter((product) => product.availableQuantity > 0)
        : sortProductsByAddedDate(menuItems).filter((product) => product.category === selectedCategory && product.availableQuantity > 0),
    [menuItems, selectedCategory],
  );
  const categories = useMemo(
    () => ['Tous', ...new Set(menuItems.map((product) => product.category).filter(Boolean))],
    [menuItems],
  );
  const [showMobileScrollTop, setShowMobileScrollTop] = useState(false);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal;

  useEffect(() => {
    if (cartOpen && cart.length > 0) {
      cartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [cartOpen, cart.length]);

  useEffect(() => {
    const updateScrollButtonVisibility = () => {
      const fifthProduct = document.getElementById('menu-product-5');
      const shouldShow = window.innerWidth < 768
        && fifthProduct !== null
        && window.scrollY >= fifthProduct.getBoundingClientRect().top + window.scrollY;
      setShowMobileScrollTop(shouldShow);
    };

    updateScrollButtonVisibility();
    window.addEventListener('scroll', updateScrollButtonVisibility, { passive: true });
    window.addEventListener('resize', updateScrollButtonVisibility);
    return () => {
      window.removeEventListener('scroll', updateScrollButtonVisibility);
      window.removeEventListener('resize', updateScrollButtonVisibility);
    };
  }, [visibleProducts.length]);

  const addToCart = (product: Product) => {
    setCartOpen(true);
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);

      if (existing) {
        if (existing.quantity >= product.availableQuantity) return current;
        return current.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }

      return [...current, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: number, delta: number) => {
    setCart((current) =>
      current
        .map((item) =>
          item.id === productId ? { ...item, quantity: Math.min(item.availableQuantity, Math.max(0, item.quantity + delta)) } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const handleCheckout = () => {
    sessionStorage.setItem(cartStorageKey(token), JSON.stringify(cart));
    navigate(`/restaurant/menu/${token}/order`);
  };


  return (
    <main className={`menu-theme ${isNightMode ? 'menu-theme-dark' : ''} min-h-screen bg-gradient-to-b from-amber-50 via-white to-slate-50 p-3 text-slate-800 sm:p-4`}>
      <div className="mx-auto w-full max-w-6xl">
        <nav className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <a href="#menu" className="font-bold text-slate-900">
            {restaurantName}
          </a>
          <div className="flex items-center gap-2 text-sm font-medium">
            <a href="#menu" className="rounded-lg px-3 py-2 text-slate-600 hover:bg-slate-100">
              Menu
            </a>
            <button
              type="button"
              onClick={() => setIsNightMode((current) => !current)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-slate-700 hover:bg-slate-100"
              aria-label={isNightMode ? 'Activer le mode jour' : 'Activer le mode nuit'}
              title={isNightMode ? 'Mode jour' : 'Mode nuit'}
            >
              {isNightMode ? '☀️' : '🌙'}
            </button>
          </div>
        </nav>

        {menuLoadError && <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{menuLoadError}</p>}

        <header className="rounded-[28px] bg-slate-900 p-5 text-white shadow-xl shadow-amber-900/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-amber-300">{tableLabel}</p>
              <h1 className="mt-2 text-2xl font-bold">{restaurantName}</h1>
            </div>
            <div className="rounded-full bg-amber-400/20 px-2.5 py-1 text-xs font-semibold text-amber-200">
              QR actif
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-300">
            Consultez les plats, ajoutez au panier et confirmez votre commande sans compte.
          </p>
        </header>

        <div id="menu-categories" className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setSelectedCategory(category)}
              className={[
                'min-h-11 shrink-0 rounded-full border px-9 py-4 text-lg font-bold transition md:min-h-0 md:px-3 md:text-base',
                selectedCategory === category
                  ? 'border-amber-500 bg-amber-500 text-white shadow-md'
                  : 'border-slate-200 bg-white text-slate-600',
              ].join(' ')}
            >
              {category}
            </button>
          ))}
        </div>

        <div id="menu" className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          <section className="min-w-0 space-y-3">
            {visibleProducts.length === 0 && (
              <p className="rounded-2xl border border-amber-200 bg-white p-5 text-sm text-slate-600">
                {menuItems.length === 0
                  ? 'Aucun article reçu du serveur. Vérifiez la connexion au serveur Laravel puis rechargez cette page.'
                  : selectedCategory === 'Tous'
                    ? 'Aucun produit n’est disponible pour le moment.'
                    : `Aucun produit disponible dans la catégorie ${selectedCategory}.`}
              </p>
            )}
            {visibleProducts.map((product, index) => (
              <article id={`menu-product-${index + 1}`} key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-3">
              <div className="flex flex-col gap-4 md:flex-row md:gap-3">
                <div className="relative flex h-96 w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-200 via-orange-100 to-yellow-50 text-3xl md:h-20 md:w-20 md:text-2xl">
                  🍽️
                  {product.image_url && <img src={productImageUrl(product.image_url)} alt={product.name} className="absolute inset-0 h-full w-full object-contain object-center" style={{ objectFit: 'contain', objectPosition: 'center' }} onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold leading-snug text-slate-800 md:text-base">{product.name}</h2>
                      <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-amber-700 md:text-[10px]">
                        {product.badge}
                      </span>
                    </div>
                    <p className="shrink-0 whitespace-nowrap text-base font-bold text-amber-600 md:text-sm">{formatCfa(product.price)}</p>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500 md:text-xs">{product.description}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-slate-400 md:text-[11px]">Préparation: {product.prepTime}</span>
                    <button
                      type="button"
                      disabled={product.availableQuantity <= 0}
                      onClick={() => addToCart(product)}
                      className="min-h-11 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300 md:min-h-0 md:px-3 md:py-1.5 md:text-xs"
                    >
                      {product.availableQuantity > 0 ? 'Ajouter' : 'Épuisé'}
                    </button>
                  </div>
                </div>
              </div>
              </article>
            ))}
          </section>

          {cart.length > 0 && (
            <aside ref={cartRef} id="panier" className="cart-panel order-first rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm lg:order-last lg:sticky lg:top-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-amber-700">Panier</p>
                <h3 className="mt-1 text-lg font-bold text-slate-800">Votre commande</h3>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                {cart.reduce((count, item) => count + item.quantity, 0)} article(s)
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {cart.map((item) => (
                <div key={item.id} className="cart-item flex items-center justify-between rounded-xl bg-white px-3 py-2">
                  <div>
                    <p className="font-medium text-slate-800">{item.name}</p>
                    <p className="text-xs text-slate-500">{formatCfa(item.price)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={`Retirer une unité de ${item.name}`}
                      onClick={() => updateQuantity(item.id, -1)}
                      className="cart-quantity-button cart-quantity-minus flex h-8 w-8 items-center justify-center rounded-full border text-base font-bold transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-rose-300"
                    >
                      −
                    </button>
                    <span className="min-w-5 text-center text-sm font-semibold">{item.quantity}</span>
                    <button
                      type="button"
                      disabled={item.quantity >= item.availableQuantity}
                      aria-label={`Ajouter une unité de ${item.name}`}
                      onClick={() => updateQuantity(item.id, 1)}
                      className="cart-quantity-button cart-quantity-plus flex h-8 w-8 items-center justify-center rounded-full border text-base font-bold transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:scale-100"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-1 text-sm text-slate-600">
              <div className="flex justify-between"><span>Sous-total</span><span>{formatCfa(subtotal)}</span></div>
              <div className="flex justify-between text-base font-bold text-slate-900">
                <span>Total</span>
                <span>{formatCfa(total)}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCheckout}
              className="mt-4 w-full rounded-xl bg-amber-500 px-4 py-3 font-semibold text-white shadow-md transition hover:bg-amber-600"
            >
              Voir mon panier
            </button>
            </aside>
          )}
        </div>

      </div>
      {showMobileScrollTop && (
        <button
          type="button"
          onClick={() => document.getElementById('menu-categories')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="fixed bottom-5 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-2xl font-bold text-white shadow-lg transition hover:bg-slate-700 md:hidden"
          aria-label="Remonter aux catégories du menu"
          title="Remonter en haut"
        >
          ↑
        </button>
      )}
    </main>
  );
}

function ClientOrderPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [orderType, setOrderType] = useState<'dine_in' | 'takeaway'>('dine_in');

  useEffect(() => {
    if (!token) return;

    try {
      const savedCart = sessionStorage.getItem(cartStorageKey(token));
      if (savedCart) {
        setCart(JSON.parse(savedCart) as CartItem[]);
      }
    } catch {
      sessionStorage.removeItem(cartStorageKey(token));
    }
  }, [token]);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = subtotal;

  const handleSubmitOrder = async () => {
    if (!token || cart.length === 0) return;

    setSubmitting(true);
    setError('');

    try {
      const response = await axios.post(`${API_BASE_URL}/public/orders/`, {
        table_token: token,
        order_type: orderType,
        note,
        items: cart.map((item) => ({
        product_id: item.id,
          quantity: item.quantity,
          note: item.note || '',
        })),
      }, { timeout: 15000 });

      sessionStorage.setItem(`restaurant-order-${token}`, JSON.stringify(response.data));
      sessionStorage.removeItem(cartStorageKey(token));
      navigate(`/restaurant/menu/${token}/status`);
    } catch (requestError) {
      if (axios.isAxiosError(requestError)) {
        const detail = requestError.response?.data?.detail || requestError.response?.data?.message;
        const status = requestError.response?.status;
        setError(detail || (requestError.code === 'ECONNABORTED'
          ? 'Le serveur ne répond pas. Vérifiez la connexion Wi-Fi et réessayez.'
          : status
          ? `Le serveur a refusé la commande (${status}). Réessayez.`
          : 'Serveur inaccessible. Vérifiez que le téléphone est sur le même Wi-Fi et réessayez.'));
      } else {
        setError('Impossible d’envoyer la commande. Réessayez.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-800">
      <div className="mx-auto max-w-md rounded-3xl bg-white p-5 shadow-lg ring-1 ring-slate-200">
        <p className="text-xs uppercase tracking-[0.28em] text-amber-600">Commande</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Confirmer votre commande</h1>

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setOrderType('dine_in')}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${orderType === 'dine_in' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            Sur place
          </button>
          <button
            type="button"
            onClick={() => setOrderType('takeaway')}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${orderType === 'takeaway' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-500'}`}
          >
            À emporter
          </button>
        </div>

        <div className="mt-5 space-y-3 rounded-2xl bg-slate-50 p-4">
          {cart.length > 0 ? cart.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm text-slate-600">
              <span>{item.name}</span>
              <span className="font-semibold text-slate-800">x{item.quantity}</span>
            </div>
          )) : <p className="text-sm text-slate-500">Votre panier est vide.</p>}
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 p-4">
          <div className="flex justify-between text-sm text-slate-600">
            <span>Sous-total</span>
            <span>{formatCfa(subtotal)}</span>
          </div>
          <div className="mt-3 flex justify-between text-lg font-bold text-slate-900">
            <span>Total</span>
            <span>{formatCfa(total)}</span>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          <label className="block text-sm font-medium text-slate-700">Remarque</label>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 outline-none ring-0 focus:border-amber-400"
            placeholder="Ex: sans oignon, bien cuit..."
          />
        </div>

        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={() => navigate(`/restaurant/menu/${token}`)}
            className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-3 font-medium text-slate-700"
          >
            Retour
          </button>
          <button
            type="button"
            disabled={cart.length === 0 || submitting}
            onClick={() => void handleSubmitOrder()}
            className="flex-1 rounded-xl bg-amber-500 px-4 py-3 font-semibold text-white shadow-md hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Envoi...' : 'Commander'}
          </button>
        </div>
      </div>
    </main>
  );
}

function ClientOrderStatusPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<{ id: number; status: string } | null>(null);
  const [statusError, setStatusError] = useState('');

  useEffect(() => {
    if (!token) return;

    const savedOrder = sessionStorage.getItem(`restaurant-order-${token}`);
    if (!savedOrder) return;

    let orderId: number;
    try {
      const saved = JSON.parse(savedOrder) as { id?: number; status?: string };
      if (!saved.id) return;
      orderId = saved.id;
      setOrder({ id: saved.id, status: saved.status || 'pending' });
    } catch {
      sessionStorage.removeItem(`restaurant-order-${token}`);
      return;
    }

    let active = true;
    const loadOrder = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/public/orders/${orderId}/`, { params: { token } });
        if (active) {
          setOrder(response.data);
          setStatusError('');
        }
      } catch {
        if (active) setStatusError('Le statut de la commande ne peut pas être actualisé pour le moment.');
      }
    };

    void loadOrder();
    const refreshTimer = window.setInterval(() => void loadOrder(), 10000);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [token]);

  const orderStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'paid'];
  const orderStatusLabels: Record<string, string> = {
    pending: 'En attente de confirmation',
    confirmed: 'Confirmée',
    preparing: 'En préparation',
    ready: 'Prête à servir',
    served: 'Servie',
    paid: 'Payée',
    cancelled: 'Annulée',
  };
  const currentStatusIndex = order ? orderStatuses.indexOf(order.status) : -1;
  const steps = [
    { label: 'Commande reçue', minimumIndex: 0, detail: 'Votre commande a été transmise au restaurant.' },
    { label: 'En préparation', minimumIndex: 2, detail: 'La cuisine prépare votre commande.' },
    { label: 'Prête à servir', minimumIndex: 3, detail: 'Votre commande est prête.' },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50 to-white p-4 text-slate-800">
      <div className="mx-auto max-w-md rounded-3xl bg-white p-5 shadow-lg ring-1 ring-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-emerald-600">Commande</p>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">Commande passée</h1>
          </div>
          <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            {order ? `#CMD-${order.id}` : 'Commande'}
          </div>
        </div>

        <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
          {order
            ? `État : ${orderStatusLabels[order.status] || order.status}. Le statut est actualisé automatiquement.`
            : 'Aucune commande récente à afficher.'}
        </div>
        {statusError && <p className="mt-3 text-sm text-rose-600">{statusError}</p>}

        <div className="mt-5 space-y-4">
          {steps.map((step) => {
            const active = currentStatusIndex >= step.minimumIndex;
            return (
            <div key={step.label} className="flex items-center gap-3">
              <div
                className={[
                  'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold',
                  active ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-slate-100 text-slate-400',
                ].join(' ')}
              >
                {active ? '✓' : '•'}
              </div>
              <div>
                <p className="font-semibold text-slate-800">{step.label}</p>
                <p className="text-xs text-slate-500">{step.detail}</p>
              </div>
            </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => navigate(`/restaurant/menu/${token}`)}
          className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-700"
        >
          Sortie
        </button>
      </div>
    </main>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register' | 'admin-register'>('login');
  const [password, setPassword] = useState('');
  const [setupKey, setSetupKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupKeyLoading, setSetupKeyLoading] = useState(false);

  useEffect(() => {
    if (mode !== 'admin-register') return;

    let active = true;
    setSetupKey('');
    setSetupKeyLoading(true);
    axios.get<{ setup_key: string }>(`${API_BASE_URL}/auth/admin/setup/`)
      .then((response) => {
        if (active) setSetupKey(response.data.setup_key);
      })
      .catch((requestError) => {
        if (!active) return;
        const message = axios.isAxiosError<{ message?: string }>(requestError)
          ? requestError.response?.data?.message
          : undefined;
        setError(message || 'Impossible de générer le code. Ouvrez cette page sur le PC serveur avec localhost.');
      })
      .finally(() => {
        if (active) setSetupKeyLoading(false);
      });

    return () => {
      active = false;
    };
  }, [mode]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (mode === 'register') {
        await axios.post(`${API_BASE_URL}/auth/register/`, {
          restaurant_name: restaurantName.trim(),
          name: name.trim(),
          phone: phone.trim() || null,
          address: address.trim() || null,
          password,
          email: email.trim(),
        });
        setMode('login');
        setSuccess('Compte partenaire activé. Connectez-vous avec votre adresse e-mail et votre mot de passe.');
      } else if (mode === 'admin-register') {
        await axios.post(`${API_BASE_URL}/auth/admin/register/`, {
          setup_key: setupKey,
          name: name.trim(),
          email: email.trim(),
          password,
        });
        setMode('login');
        setSetupKey('');
        setSuccess('Compte admin général créé. Connectez-vous avec votre adresse e-mail et votre mot de passe.');
      } else {
        sessionStorage.removeItem('adminViewRestaurantId');
        sessionStorage.removeItem('adminViewRestaurantName');
        const response = await axios.post(`${API_BASE_URL}/auth/token/`, {
          email: email.trim(),
          password,
        });

        sessionStorage.setItem('accessToken', response.data.access);
        sessionStorage.setItem('refreshToken', response.data.refresh);
        sessionStorage.setItem('staffRole', response.data.user?.role || 'partner');
        sessionStorage.setItem('staffUser', JSON.stringify(response.data.user || { email: email.trim() }));
        const requestedReturnTo = (location.state as { returnTo?: unknown } | null)?.returnTo;
        const returnTo = typeof requestedReturnTo === 'string'
          && requestedReturnTo.startsWith('/')
          && !requestedReturnTo.startsWith('//')
          && requestedReturnTo !== '/login'
          ? requestedReturnTo
          : '/dashboard';
        navigate(returnTo, { replace: true });
      }
    } catch (err: any) {
      const responseData = err.response?.data;
      const firstValidationError = (Object.values(responseData?.errors || {}) as string[][])[0]?.[0];
      const detail = firstValidationError || responseData?.detail || responseData?.message;
      setError(detail || (!err.response
        ? 'Serveur inaccessible. Vérifiez que le backend est démarré et que votre appareil est sur le même réseau.'
        : mode !== 'login'
          ? 'Impossible de créer ce compte. Vérifiez les informations saisies.'
          : 'Identifiants ou service incorrects.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-screen">
      <section className="login-showcase" aria-label="Restaurant Manager">
        <div className="login-showcase-top">
          <span className="login-logo-mark" aria-hidden="true">R</span>
          <span>Restaurant Manager</span>
        </div>
        <div className="login-showcase-copy">
          <span className="login-kicker">UNE GESTION, TOUTE VOTRE ÉQUIPE</span>
          <h2>Le service tourne.<br /><span>Vous gardez le cap.</span></h2>
          <p>Menus, commandes, équipe et tables réunis dans un espace clair, pensé pour le rythme de votre restaurant.</p>
        </div>
        <div className="login-showcase-card">
          <span className="login-showcase-card-icon" aria-hidden="true">✦</span>
          <span><strong>Tout en un seul endroit</strong><small>Votre restaurant, simplement mieux organisé.</small></span>
          <span className="login-showcase-arrow" aria-hidden="true">↗</span>
        </div>
        <div className="login-showcase-decoration" aria-hidden="true"><span>R</span></div>
      </section>

      <section className="login-form-panel">
      <form onSubmit={handleSubmit} className="login-card">
        <p className="login-mobile-brand">RESTAURANT MANAGER</p>
        <p className="login-form-eyebrow">{mode === 'login' ? 'RAVI DE VOUS REVOIR' : 'COMMENCEZ ICI'}</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">
          {mode === 'login' ? 'Connexion' : mode === 'register' ? 'Créer un compte partenaire' : 'Créer un compte admin général'}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {mode === 'admin-register'
            ? 'Le compte admin général donne accès à tous les restaurants et nécessite un code d’installation.'
            : 'Inscrivez votre restaurant, connectez-vous, puis configurez vos menus, QR codes et commandes.'}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2" aria-label="Type de compte">
          {[
            { value: 'login', label: 'Connexion' },
            { value: 'register', label: 'Partenaire' },
            { value: 'admin-register', label: 'Admin général' },
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={mode === tab.value}
              onClick={() => { setMode(tab.value as typeof mode); setError(''); setSuccess(''); }}
              className={`rounded-lg px-2 py-2 text-xs font-semibold ${
                mode === tab.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-4">
          {mode === 'register' && (
            <>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Nom du restaurant</label>
                <input value={restaurantName} onChange={(event) => setRestaurantName(event.target.value)} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Votre nom complet</label>
                <input value={name} onChange={(event) => setName(event.target.value)} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Téléphone (facultatif)</label>
                <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Adresse (facultatif)</label>
                <input value={address} onChange={(event) => setAddress(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 outline-none focus:border-amber-400" />
              </div>
            </>
          )}

          {mode === 'admin-register' && (
            <>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Votre nom complet</label>
                <input value={name} onChange={(event) => setName(event.target.value)} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 outline-none focus:border-amber-400" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Code d’installation</label>
                <input
                  type="text"
                  autoComplete="off"
                  value={setupKeyLoading ? 'Génération du code…' : setupKey}
                  readOnly
                  required
                  aria-describedby="admin-setup-help"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-800 outline-none focus:border-amber-400"
                />
                <p id="admin-setup-help" className="mt-1 text-xs text-slate-500">
                  Code affiché automatiquement sur le PC serveur, valable 15 minutes et utilisable une seule fois.
                </p>
              </div>
            </>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Adresse e-mail</label>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 outline-none focus:border-amber-400" />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Mot de passe</label>
            <div className="flex gap-2">
              <input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === 'login' ? undefined : 8} required className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 outline-none focus:border-amber-400" />
              <button type="button" onClick={() => setShowPassword((current) => !current)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600" aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                {showPassword ? 'Masquer' : 'Afficher'}
              </button>
            </div>
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}
        {success && <p className="mt-4 text-sm text-emerald-600">{success}</p>}

        <button
          type="submit"
          disabled={loading || (mode === 'admin-register' && (setupKeyLoading || !setupKey))}
          className="mt-6 w-full rounded-xl bg-amber-500 px-4 py-3 font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? 'Traitement...' : mode === 'login' ? 'Se connecter' : mode === 'register' ? 'Créer le compte partenaire' : 'Créer le compte admin'}
        </button>
        <p className="login-form-footer">Une plateforme dédiée à la bonne marche de votre restaurant.</p>
      </form>
      </section>
    </main>
  );
}

function TablesPage() {
  return (
    <AdminShell title="Gestion des Tables">
      <TableManagement />
    </AdminShell>
  );
}

function MenuPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [savingProduct, setSavingProduct] = useState(false);
  const navigate = useNavigate();
  const isEditingProduct = editingProduct !== null;

  useEffect(() => {
    const loadProducts = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/products/`, { headers: withAuth() });
        setProducts(Array.isArray(response.data) ? response.data : response.data.results || []);
        setError('');
      } catch (requestError) {
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          sessionStorage.removeItem('accessToken');
          sessionStorage.removeItem('refreshToken');
          sessionStorage.removeItem('staffRole');
          navigate('/login', { replace: true });
          return;
        }
        setError('Impossible de charger le menu.');
      } finally {
        setLoading(false);
      }
    };

    if (isEditingProduct) return;

    let active = true;
    let refreshTimer: number;
    const refreshProducts = async () => {
      await loadProducts();
      if (active) refreshTimer = window.setTimeout(() => void refreshProducts(), 10000);
    };
    void refreshProducts();

    return () => {
      active = false;
      window.clearTimeout(refreshTimer);
    };
  }, [isEditingProduct, navigate]);

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingProduct) return;

    setSavingProduct(true);
    setError('');
    try {
      const response = await axios.patch(`${API_BASE_URL}/products/${editingProduct.id}/`, {
        name: editingProduct.name,
        description: editingProduct.description || '',
        price: editingProduct.price,
        preparation_time: editingProduct.preparation_time,
        available_quantity: editingProduct.available_quantity,
        is_available: editingProduct.is_available,
        is_active: editingProduct.is_active,
        category: editingProduct.category,
      }, { headers: withAuth() });
      setProducts((currentProducts) => currentProducts.map((product) => (
        product.id === response.data.id ? response.data : product
      )));
      setEditingProduct(null);
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.data) {
        const details = requestError.response.data;
        setError(details.detail || 'Impossible de mettre à jour ce produit.');
      } else {
        setError('Impossible de mettre à jour ce produit.');
      }
    } finally {
      setSavingProduct(false);
    }
  };

  const availableMeals = products
    .filter((product) => product.is_available && product.is_active !== false)
    .reduce((total, product) => total + Number(product.available_quantity || 0), 0);

  return (
    <AdminShell title="Menu & Produits">
      {error && <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <MenuManagement />
      {loading ? <p className="text-slate-500">Chargement du menu...</p> : <div className="space-y-4">
        <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div>
            <p className="text-sm font-medium text-emerald-700">Repas disponibles</p>
            <p className="mt-1 text-3xl font-bold text-emerald-900">{availableMeals}</p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-700">Au menu</span>
        </div>
        {editingProduct && (
          <form onSubmit={saveProduct} className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-bold text-slate-900">Modifier le produit</h2>
              <button type="button" onClick={() => setEditingProduct(null)} className="text-sm font-medium text-slate-600 hover:text-slate-900">
                Annuler
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <input value={editingProduct.name} onChange={(event) => setEditingProduct({ ...editingProduct, name: event.target.value })} required placeholder="Nom" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
              <input type="number" min="0" step="1" value={editingProduct.price} onChange={(event) => setEditingProduct({ ...editingProduct, price: event.target.value })} required placeholder="Prix" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
              <input type="number" min="0" step="1" value={editingProduct.available_quantity} onChange={(event) => setEditingProduct({ ...editingProduct, available_quantity: event.target.value })} required placeholder="Stock" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
              <input type="number" min="0" step="1" value={editingProduct.preparation_time} onChange={(event) => setEditingProduct({ ...editingProduct, preparation_time: event.target.value })} required placeholder="Préparation (minutes)" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
            </div>
            <textarea value={editingProduct.description || ''} onChange={(event) => setEditingProduct({ ...editingProduct, description: event.target.value })} placeholder="Description" rows={3} className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
            <label className="menu-edit-availability mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium">
              <input type="checkbox" checked={Boolean(editingProduct.is_available)} onChange={(event) => setEditingProduct({ ...editingProduct, is_available: event.target.checked })} className="h-4 w-4 accent-amber-500" />
              Disponible à la commande
            </label>
            <button type="submit" disabled={savingProduct} className="mt-4 rounded-xl bg-amber-500 px-4 py-2.5 font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
              {savingProduct ? 'Enregistrement...' : 'Enregistrer les modifications'}
            </button>
          </form>
        )}
        <div className="data-scroll max-h-[32rem] overflow-auto space-y-3 pr-1">
        {sortProductsByAddedDate(products).map((product) => (
          <div key={product.name} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="font-bold text-slate-900">{product.name}</p>
              <p className="text-sm text-slate-500">{product.category_name || product.category?.name || 'Sans catégorie'}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${product.is_available && Number(product.available_quantity || 0) > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                {product.is_available && Number(product.available_quantity || 0) > 0 ? `${product.available_quantity} disponible(s)` : '0 disponible'}
              </span>
              <span className="font-semibold text-amber-600">{formatCfa(Number(product.price || 0))}</span>
              <button type="button" onClick={() => setEditingProduct({ ...product })} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700">Éditer</button>
            </div>
          </div>
        ))}
        </div>
      </div>}
    </AdminShell>
  );
}

const orderStatusLabels: Record<string, string> = {
  pending: 'En attente du gérant',
  confirmed: 'Confirmée',
  preparing: 'En préparation',
  ready: 'Prête à servir',
  served: 'Client servi',
  paid: 'Payée',
  cancelled: 'Annulée',
  refused: 'Refusée',
};

const revenueGeneratingStatuses = new Set(['served', 'paid']);

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

function OrdersPage({ title = 'Commandes' }: { title?: string }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [transitioningId, setTransitioningId] = useState<number | null>(null);
  const role = getStaffRole();
  const showActions = (title === 'Cuisine' && role === 'cook') || role === 'server';

  const canTransition = (order: any) => (
    (role === 'cook' && ['confirmed', 'preparing'].includes(order.status))
    || (role === 'server' && order.status === 'ready')
  );

  const transitionOrder = async (order: any) => {
    setTransitioningId(order.id);
    setError('');
    try {
      const response = await axios.post(`${API_BASE_URL}/orders/${order.id}/transition/`, {}, { headers: withAuth() });
      setOrders((current) => current.map((item) => item.id === order.id ? response.data : item));
    } catch (requestError: any) {
      setError(
        requestError.response?.data?.errors?.status?.[0]
        || requestError.response?.data?.message
        || requestError.response?.data?.detail
        || 'Impossible de faire avancer cette commande.',
      );
    } finally {
      setTransitioningId(null);
    }
  };

  useEffect(() => {
    const loadOrders = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/orders/`, { headers: withAuth() });
        const data = Array.isArray(response.data) ? response.data : response.data.results || [];
        setOrders(data);
        setError('');
      } catch (requestError) {
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          sessionStorage.removeItem('accessToken');
          sessionStorage.removeItem('staffRole');
          navigate('/login', { replace: true });
          return;
        }
        setError('Impossible de charger les commandes.');
      } finally {
        setLoading(false);
      }
    };

    void loadOrders();
    const refreshTimer = window.setInterval(() => void loadOrders(), 10000);
    return () => window.clearInterval(refreshTimer);
  }, [navigate]);

  const filteredOrders = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase('fr-FR');
    if (!normalizedSearch) return sortOrdersByActivity(orders);

    return sortOrdersByActivity(orders).filter((order) => [
      `#CMD-${order.id}`,
      order.table ? `Table ${order.table}` : 'Table inconnue',
      orderStatusLabels[order.status] || order.status,
      formatCfa(Number(order.total_amount || 0)),
      formatOrderDate(order.created_at),
    ].some((value) => String(value).toLocaleLowerCase('fr-FR').includes(normalizedSearch)));
  }, [orders, searchTerm]);

  return (
    <AdminShell title={title}>
      {error && <p className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="mb-4">
        <label htmlFor="order-search" className="sr-only">Rechercher une commande</label>
        <input
          id="order-search"
          type="search"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Rechercher une commande, une table ou un statut..."
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />
      </div>
      <div className="orders-scroll-container max-h-[32rem] overflow-auto rounded-2xl border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 shadow-sm">
            <tr>
              <th className="px-4 py-3 font-medium">Commande</th>
              <th className="px-4 py-3 font-medium">Table</th>
              <th className="px-4 py-3 font-medium">Total</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium">Cuisiné par</th>
              <th className="px-4 py-3 font-medium">Dernière action par</th>
              <th className="px-4 py-3 font-medium">Date</th>
              {showActions && <th className="px-4 py-3 font-medium">Action</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={showActions ? 8 : 7} className="px-4 py-8 text-center text-slate-500">Chargement des commandes...</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={showActions ? 8 : 7} className="px-4 py-8 text-center text-slate-500">Aucune commande enregistrée.</td></tr>
            ) : filteredOrders.length === 0 ? (
              <tr><td colSpan={showActions ? 8 : 7} className="px-4 py-8 text-center text-slate-500">Aucune commande ne correspond à votre recherche.</td></tr>
            ) : filteredOrders.map((order) => (
              <tr key={order.id} className="border-t border-slate-200">
                <td className="px-4 py-3 font-medium">
                  <Link to={`/orders/${order.id}`} className="text-amber-700 hover:text-amber-900 hover:underline">
                    #CMD-{order.id}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{order.order_type === 'takeaway' ? 'À emporter' : order.table ? `Table ${order.table}` : 'Table inconnue'}</td>
                <td className="px-4 py-3 font-semibold text-slate-900">{formatCfa(Number(order.total_amount || 0))}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700">{orderStatusLabels[order.status] || order.status}</span>
                </td>
                <td className="px-4 py-3 text-slate-600">{order.cooked_by_name || 'Pas encore cuisiné'}</td>
                <td className="px-4 py-3 text-slate-600">{order.last_action_by_name || 'Commande client'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatOrderDate(order.created_at)}</td>
                {showActions && (
                  <td className="px-4 py-3">
                    {canTransition(order) && (
                      <button
                        type="button"
                        disabled={transitioningId === order.id}
                        onClick={() => void transitionOrder(order)}
                        className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {transitioningId === order.id ? 'Envoi...' : getOrderActionLabel(role, order.status)}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}

function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadOrder = async () => {
      if (!orderId) return;

      try {
        const response = await axios.get(`${API_BASE_URL}/orders/${orderId}/`, { headers: withAuth() });
        setOrder(response.data);
        setError('');
      } catch (requestError) {
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          sessionStorage.removeItem('accessToken');
          sessionStorage.removeItem('refreshToken');
          sessionStorage.removeItem('staffRole');
          navigate('/login', { replace: true });
          return;
        }
        setError('Impossible de charger les détails de la commande.');
      } finally {
        setLoading(false);
      }
    };

    void loadOrder();
  }, [navigate, orderId]);

  return (
    <AdminShell title={order ? `Commande #CMD-${order.id}` : 'Détail de la commande'}>
      <div className="print-hidden mb-5 flex items-center justify-between gap-3">
        <button type="button" onClick={() => navigate('/orders')} className="text-sm font-semibold text-slate-600 hover:text-slate-900">
          ← Retour aux commandes
        </button>
        <button type="button" onClick={() => window.print()} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600">
          Imprimer
        </button>
      </div>

      {loading && <p className="text-slate-500">Chargement de la commande...</p>}
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {order && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-amber-600">Commande</p>
                <h2 className="mt-1 text-2xl font-bold text-slate-900">#CMD-{order.id}</h2>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
                {orderStatusLabels[order.status] || order.status}
              </span>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-slate-500">Table</dt><dd className="mt-1 font-semibold text-slate-900">{order.order_type === 'takeaway' ? 'À emporter' : order.table ? `Table ${order.table}` : 'Table inconnue'}</dd></div>
              <div><dt className="text-slate-500">Date</dt><dd className="mt-1 font-semibold text-slate-900">{formatOrderDate(order.created_at)}</dd></div>
              <div><dt className="text-slate-500">Total</dt><dd className="mt-1 font-semibold text-slate-900">{formatCfa(Number(order.total_amount || 0))}</dd></div>
              <div><dt className="text-slate-500">Cuisiné par</dt><dd className="mt-1 font-semibold text-slate-900">{order.cooked_by_name || 'Pas encore cuisiné'}</dd></div>
            </dl>
          </section>

          <section className="data-scroll max-h-[24rem] overflow-auto rounded-2xl border border-slate-200">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Articles commandés</h2>
            </div>
            <div className="divide-y divide-slate-200">
              {(order.items || []).map((item: any) => (
                <div key={item.id} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div>
                    <p className="font-semibold text-slate-900">{item.product_name || `Produit #${item.product}`}</p>
                    {item.note && <p className="mt-1 text-xs text-slate-500">Note : {item.note}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-500">x{item.quantity}</p>
                    <p className="font-semibold text-slate-900">{formatCfa(Number(item.unit_price || 0) * Number(item.quantity || 0))}</p>
                  </div>
                </div>
              ))}
            </div>
            {order.note && <p className="border-t border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">Remarque : {order.note}</p>}
          </section>
        </div>
      )}
    </AdminShell>
  );
}

function KitchenPage() {
  return <OrdersPage title="Cuisine" />;
}

function InventoryPage() {
  const navigate = useNavigate();
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [menuProducts, setMenuProducts] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const inventoryLoadRequest = useRef<Promise<void> | null>(null);
  const [savingMenuProduct, setSavingMenuProduct] = useState(false);
  const [inventoryLoadFailed, setInventoryLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newIngredient, setNewIngredient] = useState({ name: '', unit: 'kg', current_stock: '0', alert_threshold: '0' });
  const [movement, setMovement] = useState({ ingredient: '', movement_type: 'entry', source: 'purchase', quantity: '', notes: '' });
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [viewingProduct, setViewingProduct] = useState<any | null>(null);
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [productImagePreview, setProductImagePreview] = useState('');
  const [productForm, setProductForm] = useState({ name: '', description: '', price: '', preparation_time: '10', available_quantity: '1', is_available: true, image_url: '', remove_image: false });

  useEffect(() => {
    if (productImageFile) {
      const objectUrl = URL.createObjectURL(productImageFile);
      setProductImagePreview(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }

    setProductImagePreview(productImageUrl(productForm.image_url));
  }, [productImageFile, productForm.image_url]);

  const loadInventory = async () => {
    if (inventoryLoadRequest.current) return inventoryLoadRequest.current;

    const request = (async () => {
      try {
        const [ingredientsResponse, movementsResponse, productsResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/ingredients/`, { headers: withAuth(), timeout: 5000 }),
          axios.get(`${API_BASE_URL}/stock-movements/`, { headers: withAuth(), timeout: 5000 }),
          axios.get(`${API_BASE_URL}/products/`, { headers: withAuth(), timeout: 5000 }),
        ]);
        const normalize = (data: any) => Array.isArray(data) ? data : data.results || [];
        const loadedIngredients = normalize(ingredientsResponse.data);
        setIngredients(loadedIngredients);
        setMovements(normalize(movementsResponse.data));
        setMenuProducts(normalize(productsResponse.data));
        if (!movement.ingredient && loadedIngredients[0]) setMovement((current) => ({ ...current, ingredient: String(loadedIngredients[0].id) }));
        setInventoryLoadFailed(false);
        setError('');
      } catch (requestError) {
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          sessionStorage.removeItem('accessToken');
          sessionStorage.removeItem('refreshToken');
          sessionStorage.removeItem('staffRole');
          navigate('/login', { replace: true });
          return;
        }
        setInventoryLoadFailed(true);
        setError(axios.isAxiosError(requestError) && ['ECONNABORTED', 'ETIMEDOUT'].includes(requestError.code || '')
          ? 'Le serveur n’a pas répondu en 5 secondes. Vérifiez le backend puis rechargez la page.'
          : 'Impossible de charger les stocks.');
      } finally {
        setLoading(false);
        inventoryLoadRequest.current = null;
      }
    })();
    inventoryLoadRequest.current = request;
    return request;
  };

  useEffect(() => {
    if (productFormOpen) return;

    let cancelled = false;
    let refreshTimer: number;
    const refreshInventory = async () => {
      await loadInventory();
      if (!cancelled) refreshTimer = window.setTimeout(() => void refreshInventory(), 10000);
    };
    void refreshInventory();

    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
    };
  }, [productFormOpen]);

  const addIngredient = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      await axios.post(`${API_BASE_URL}/ingredients/`, newIngredient, { headers: withAuth() });
      setNewIngredient({ name: '', unit: 'kg', current_stock: '0', alert_threshold: '0' });
      setMessage('Ingrédient ajouté.');
      await loadInventory();
    } catch {
      setError('Impossible d’ajouter cet ingrédient.');
    }
  };

  const addMovement = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      await axios.post(`${API_BASE_URL}/stock-movements/`, movement, { headers: withAuth() });
      setMovement((current) => ({ ...current, quantity: '', notes: '' }));
      setMessage('Mouvement enregistré.');
      await loadInventory();
    } catch (requestError: any) {
      setError(requestError.response?.data?.detail || 'Impossible d’enregistrer le mouvement.');
    }
  };

  const updateMenuAvailability = async (product: any) => {
    try {
      await axios.patch(`${API_BASE_URL}/products/${product.id}/`, { is_available: !product.is_available }, { headers: withAuth() });
      setMenuProducts((current) => current.map((item) => item.id === product.id ? { ...item, is_available: !product.is_available } : item));
      setMessage(`${product.name} est maintenant ${product.is_available ? 'indisponible' : 'disponible'}.`);
    } catch {
      setError(`Impossible de modifier la disponibilité de ${product.name}.`);
    }
  };

  const openProductForm = (product: any | null = null) => {
    setEditingProduct(product);
    setProductImageFile(null);
    const nextForm = product ? {
      name: product.name,
      description: product.description || '',
      price: String(product.price),
      preparation_time: String(product.preparation_time || 10),
      available_quantity: String(product.available_quantity ?? 1),
      is_available: product.is_available,
      image_url: product.image_url || '',
      remove_image: false,
    } : { name: '', description: '', price: '', preparation_time: '10', available_quantity: '1', is_available: true, image_url: '', remove_image: false };
    setProductForm(nextForm);
    setProductFormOpen(true);
  };


  const saveMenuProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingMenuProduct) return;
    setError('');
    setMessage('');
    try {
      const price = Number(productForm.price);
      const preparationTime = Number(productForm.preparation_time);
      const availableQuantity = Number(productForm.available_quantity);
      if (!productForm.name.trim() || !productForm.price.trim() || !Number.isFinite(price) || price < 0 || !Number.isInteger(preparationTime) || preparationTime < 1 || !Number.isInteger(availableQuantity) || availableQuantity < 0) {
        setError('Renseignez un nom, un prix et une quantité valide.');
        return;
      }
      setSavingMenuProduct(true);
      setMessage('Enregistrement du produit...');
      const payload = new FormData();
      payload.append('name', productForm.name.trim());
      payload.append('description', productForm.description);
      payload.append('price', String(price));
      payload.append('preparation_time', String(preparationTime));
      payload.append('available_quantity', String(availableQuantity));
      payload.append('is_available', productForm.is_available && availableQuantity > 0 ? '1' : '0');
      if (editingProduct) {
        payload.append('_method', 'PATCH');
        if (productImageFile) {
          payload.append('image', productImageFile);
        } else if (productForm.image_url.startsWith('http://') || productForm.image_url.startsWith('https://')) {
          payload.append('image_url', productForm.image_url);
        } else if (productForm.remove_image) {
          payload.append('remove_image', '1');
        }
        await axios.post(`${API_BASE_URL}/products/${editingProduct.id}/`, payload, { headers: withAuth() });
        setMessage('Produit du menu modifié.');
      } else {
        if (productImageFile) {
          payload.append('image', productImageFile);
        } else if (productForm.image_url.startsWith('http://') || productForm.image_url.startsWith('https://')) {
          payload.append('image_url', productForm.image_url);
        }
        await axios.post(`${API_BASE_URL}/products/`, payload, { headers: withAuth() });
        setMessage('Produit du menu ajouté.');
      }
      setProductFormOpen(false);
      await loadInventory();
    } catch (requestError: any) {
      const responseData = requestError.response?.data;
      const validationErrors = Object.values(responseData?.errors || {}).flatMap((messages) => (
        Array.isArray(messages) ? messages : [messages]
      ));
      const detail = responseData?.detail || validationErrors.join(' ') || Object.values(responseData || {}).flat().join(' ');
      setError(detail || (!requestError.response
        ? 'Serveur inaccessible. Vérifiez que le backend est démarré.'
        : 'Impossible d’enregistrer le produit du menu.'));
    } finally {
      setSavingMenuProduct(false);
    }
  };

  const deleteMenuProduct = async (product: any) => {
    if (!window.confirm(`Supprimer « ${product.name} » du menu ?`)) return;
    try {
      await axios.delete(`${API_BASE_URL}/products/${product.id}/`, { headers: withAuth() });
      setMessage('Produit du menu supprimé.');
      await loadInventory();
    } catch {
      setError(`Impossible de supprimer ${product.name}.`);
    }
  };

  return (
    <AdminShell title="Inventaire & Stocks">
      <div className="space-y-6">
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}

        <div className="grid gap-5 xl:grid-cols-2">
          <form onSubmit={addIngredient} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-lg font-bold text-slate-900">Ajouter un produit en stock</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input required placeholder="Nom (ex. Tomates)" value={newIngredient.name} onChange={(event) => setNewIngredient({ ...newIngredient, name: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
              <input required placeholder="Unité (kg, litre...)" value={newIngredient.unit} onChange={(event) => setNewIngredient({ ...newIngredient, unit: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
              <input type="number" min="0" step="0.01" placeholder="Quantité initiale" value={newIngredient.current_stock} onChange={(event) => setNewIngredient({ ...newIngredient, current_stock: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
              <input type="number" min="0" step="0.01" placeholder="Seuil d’alerte" value={newIngredient.alert_threshold} onChange={(event) => setNewIngredient({ ...newIngredient, alert_threshold: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
            </div>
            <button className="mt-4 rounded-xl bg-amber-500 px-4 py-2.5 font-semibold text-white">Ajouter</button>
          </form>

          <form onSubmit={addMovement} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-lg font-bold text-slate-900">Enregistrer une entrée ou sortie</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <select required value={movement.ingredient} onChange={(event) => setMovement({ ...movement, ingredient: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <option value="">Choisir un produit</option>
                {ingredients.map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}
              </select>
              <select value={movement.movement_type} onChange={(event) => setMovement({ ...movement, movement_type: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="entry">Entrée</option><option value="exit">Sortie</option></select>
              <input required type="number" min="0.01" step="0.01" placeholder="Quantité" value={movement.quantity} onChange={(event) => setMovement({ ...movement, quantity: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
              <select value={movement.source} onChange={(event) => setMovement({ ...movement, source: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="purchase">Achat</option><option value="supply">Approvisionnement</option><option value="consumption">Consommation</option><option value="loss">Perte</option><option value="expired">Périmé</option></select>
              <input placeholder="Note (facultatif)" value={movement.notes} onChange={(event) => setMovement({ ...movement, notes: event.target.value })} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 sm:col-span-2" />
            </div>
            <button className="mt-4 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white">Enregistrer</button>
          </form>
        </div>

        <section>
          <h2 className="mb-3 text-xl font-bold text-slate-900">Stocks actuels</h2>
          {loading ? <p className="text-slate-500">Chargement...</p> : inventoryLoadFailed ? <p className="rounded-xl bg-slate-50 p-4 text-slate-500">Stocks temporairement indisponibles.</p> : ingredients.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-slate-500">Aucun produit en stock.</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ingredients.map((ingredient) => <div key={ingredient.id} className={`rounded-2xl border p-4 ${ingredient.is_low_stock ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}><div className="flex items-center justify-between"><h3 className="font-bold text-slate-900">{ingredient.name}</h3><span className={`rounded-full px-2 py-1 text-xs font-semibold ${ingredient.is_low_stock ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{ingredient.is_low_stock ? 'Stock faible' : 'Normal'}</span></div><p className="mt-3 text-2xl font-bold text-slate-900">{ingredient.current_stock} <span className="text-sm font-medium text-slate-500">{ingredient.unit}</span></p><p className="mt-1 text-sm text-slate-500">Seuil d’alerte : {ingredient.alert_threshold} {ingredient.unit}</p></div>)}
          </div>}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Produits du menu</h2>
              <p className="mt-1 text-sm text-slate-500">Désactivez un plat lorsqu’il n’est plus disponible en stock.</p>
            </div>
            <button type="button" onClick={() => openProductForm()} className="rounded-xl bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600">Ajouter un menu</button>
          </div>
          {inventoryLoadFailed ? <p className="rounded-xl bg-slate-50 p-4 text-slate-500">Menu temporairement indisponible.</p> : menuProducts.length === 0 ? <p className="rounded-xl bg-slate-50 p-4 text-slate-500">Aucun produit du menu.</p> : <div className="data-scroll max-h-[32rem] overflow-auto grid gap-3 pr-1 md:grid-cols-2 xl:grid-cols-3">
            {sortProductsByAddedDate(menuProducts).map((product) => <div key={product.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-bold text-slate-900">{product.name}</h3><p className="mt-1 text-sm text-amber-600">{formatCfa(Number(product.price || 0))}</p></div><button type="button" onClick={() => void updateMenuAvailability(product)} className={`shrink-0 rounded-xl px-3 py-2 text-xs font-semibold ${product.is_available ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{product.is_available ? `Disponible · ${product.available_quantity ?? 0}` : `Indisponible · ${product.available_quantity ?? 0}`}</button></div><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => setViewingProduct(product)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Voir</button><button type="button" onClick={() => openProductForm(product)} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-700">Modifier</button><button type="button" onClick={() => void deleteMenuProduct(product)} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700">Supprimer</button></div></div>)}
          </div>}
        </section>

        {productFormOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <form noValidate onSubmit={saveMenuProduct} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
              <h2 className="text-xl font-bold text-slate-900">{editingProduct ? 'Modifier le produit' : 'Ajouter un produit au menu'}</h2>
              <div className="mt-4 space-y-3">
                <input required placeholder="Nom du produit" value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" />
                <textarea placeholder="Description" rows={3} value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <input required type="number" min="0" step="0.01" placeholder="Prix" value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: event.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" />
                  <input required type="number" min="0" step="1" placeholder="Nombre disponible" value={productForm.available_quantity} onChange={(event) => setProductForm({ ...productForm, available_quantity: event.target.value })} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" />
                </div>
                <section className="space-y-3 rounded-xl border border-slate-200 p-3">
                  <h3 className="text-sm font-semibold text-slate-800">Image du produit (facultative)</h3>
                  <label className="block text-sm font-medium text-slate-700">
                    Choisir une image sur cet appareil
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0] || null;
                        setProductImageFile(file);
                        if (file) setProductForm((current) => ({ ...current, image_url: '', remove_image: false }));
                      }}
                      className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-100 file:px-3 file:py-2 file:font-semibold file:text-amber-800"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Ou coller le lien d’une image en ligne
                    <input
                      type="url"
                      value={productForm.image_url.startsWith('/storage/') ? '' : productForm.image_url}
                      onChange={(event) => {
                        setProductImageFile(null);
                        setProductForm((current) => ({ ...current, image_url: event.target.value, remove_image: false }));
                      }}
                      placeholder="https://exemple.com/image.jpg"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
                    />
                  </label>
                  {productImagePreview && (
                    <img src={productImageUrl(productImagePreview)} alt="Aperçu du produit" className="h-32 w-full rounded-xl bg-slate-50 object-contain" />
                  )}
                  {(productImagePreview || productForm.image_url) && (
                    <button
                      type="button"
                      onClick={() => {
                        setProductImageFile(null);
                        setProductForm((current) => ({ ...current, image_url: '', remove_image: true }));
                      }}
                      className="text-sm font-semibold text-rose-600"
                    >
                      Retirer l’image
                    </button>
                  )}
                  <p className="text-xs text-slate-500">Formats JPG, PNG, WEBP ou GIF · fichier limité à 5 Mo.</p>
                </section>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={productForm.is_available} onChange={(event) => setProductForm({ ...productForm, is_available: event.target.checked })} />
                  Disponible immédiatement
                </label>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setProductFormOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2.5 font-semibold text-slate-700">Annuler</button>
                <button type="submit" disabled={savingMenuProduct} className="rounded-xl bg-amber-500 px-4 py-2.5 font-semibold text-white disabled:cursor-wait disabled:opacity-60">{savingMenuProduct ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          </div>
        )}

        {viewingProduct && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
            <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
              <div className="relative mb-5 flex h-56 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-200 via-orange-100 to-yellow-50 text-5xl">
                🍽️
                {viewingProduct.image_url && (
                  <img
                    src={productImageUrl(viewingProduct.image_url)}
                    alt={viewingProduct.name}
                    className="absolute inset-0 h-full w-full object-contain"
                    onError={(event) => { event.currentTarget.style.display = 'none'; }}
                  />
                )}
              </div>
              <p className="text-xs uppercase tracking-wider text-amber-600">Produit du menu</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">{viewingProduct.name}</h2>
              <p className="mt-3 text-sm text-slate-600">{viewingProduct.description || 'Aucune description.'}</p>
              <dl className="mt-5 space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Prix</dt><dd className="font-semibold">{formatCfa(Number(viewingProduct.price || 0))}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Préparation</dt><dd className="font-semibold">{viewingProduct.preparation_time || 10} min</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Disponibilité</dt><dd className="font-semibold">{viewingProduct.is_available ? 'Disponible' : 'Indisponible'}</dd></div>
              </dl>
              <button type="button" onClick={() => setViewingProduct(null)} className="mt-6 w-full rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white">Fermer</button>
            </div>
          </div>
        )}

        <section>
          <h2 className="mb-3 text-xl font-bold text-slate-900">Historique des mouvements</h2>
          <div className="data-scroll max-h-[24rem] overflow-auto rounded-2xl border border-slate-200"><table className="min-w-full text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-50 text-slate-600 shadow-sm"><tr><th className="px-4 py-3">Produit</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Quantité</th><th className="px-4 py-3">Effectué par</th><th className="px-4 py-3">Date</th></tr></thead><tbody>{movements.slice(0, 20).map((item) => <tr key={item.id} className="border-t border-slate-200"><td className="px-4 py-3 font-medium">{item.ingredient_name}</td><td className="px-4 py-3">{item.movement_type === 'entry' ? 'Entrée' : 'Sortie'}</td><td className="px-4 py-3">{item.quantity} {item.ingredient_unit}</td><td className="px-4 py-3 text-slate-600">{item.performed_by_name || 'Utilisateur inconnu'}</td><td className="px-4 py-3 text-slate-500">{new Date(item.created_at).toLocaleString('fr-FR')}</td></tr>)}</tbody></table></div>
        </section>
      </div>
    </AdminShell>
  );
}

function ReservationsPage() {
  const reservations = [
    { customer: 'Mariam', date: '18/08/2026', time: '19:30', party: 4 },
    { customer: 'Koffi', date: '19/08/2026', time: '20:00', party: 2 },
  ];

  return (
    <AdminShell title="Réservations">
      <div className="space-y-3">
        {reservations.map((res) => (
          <div key={res.customer} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="font-bold text-slate-900">{res.customer}</p>
              <p className="text-sm text-slate-500">{res.date} · {res.time} · {res.party} personnes</p>
            </div>
            <span className="rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-700">Confirmée</span>
          </div>
        ))}
      </div>
    </AdminShell>
  );
}

function ReportsPage() {
  const stats = [
    { label: 'Ventes du jour', value: '1 240 000 XOF' },
    { label: 'Bénéfice', value: '410 000 XOF' },
    { label: 'Déplacements', value: '08' },
  ];

  return (
    <AdminShell title="Rapports & Statistiques">
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((item) => (
          <div key={item.label} className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200">
            <p className="text-sm text-slate-500">{item.label}</p>
            <p className="mt-3 text-2xl font-bold text-slate-900">{item.value}</p>
          </div>
        ))}
      </div>
    </AdminShell>
  );
}

function ConfigurationPage() {
  const [restaurantId, setRestaurantId] = useState<number | null>(null);
  const [siteName, setSiteName] = useState('');
  const [settingId, setSettingId] = useState<number | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({
    qr_ordering: true,
    reservations: true,
    inventory: true,
    kitchen: true,
    reports: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [settingsResponse, restaurantsResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/restaurant-settings/`, { headers: withAuth() }),
          axios.get(`${API_BASE_URL}/restaurants/`, { headers: withAuth() }),
        ]);
        const settings = Array.isArray(settingsResponse.data) ? settingsResponse.data : settingsResponse.data.results || [];
        const restaurants = Array.isArray(restaurantsResponse.data) ? restaurantsResponse.data : restaurantsResponse.data.results || [];
        const setting = settings[0];
        const restaurant = restaurants[0];
        if (setting) {
          setSettingId(setting.id);
          setFeatures((current) => ({ ...current, ...(setting.feature_flags || {}) }));
        }
        if (restaurant) {
          setRestaurantId(restaurant.id);
          setSiteName(restaurant.name || '');
        }
      } catch (requestError) {
        if (axios.isAxiosError(requestError) && requestError.response?.status === 401) {
          sessionStorage.removeItem('accessToken');
          sessionStorage.removeItem('refreshToken');
          sessionStorage.removeItem('staffRole');
          navigate('/login', { replace: true });
          return;
        }
        setError('Impossible de charger la configuration.');
      } finally {
        setLoading(false);
      }
    };

    void loadSettings();
    const refreshTimer = window.setInterval(() => void loadSettings(), 10000);
    return () => window.clearInterval(refreshTimer);
  }, [navigate]);

  const saveSettings = async () => {
    if (!settingId) {
      setError('Aucun paramètre de restaurant n’est disponible.');
      return;
    }

    setSaving(true);
    setMessage('');
    setError('');
    try {
      if (!restaurantId || !siteName.trim()) {
        setError('Le nom du site est obligatoire.');
        return;
      }

      await axios.patch(`${API_BASE_URL}/restaurants/${restaurantId}/`, { name: siteName.trim() }, { headers: withAuth() });
      await axios.patch(`${API_BASE_URL}/restaurant-settings/${settingId}/`, { feature_flags: features }, { headers: withAuth() });
      setMessage('Configuration enregistrée.');
    } catch (requestError) {
      if (axios.isAxiosError(requestError) && requestError.response?.status === 403) {
        setError('Seul le gérant ou l’administrateur peut modifier la configuration.');
      } else {
        setError('Impossible d’enregistrer la configuration.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminShell title="Configuration">
      <div className="max-w-3xl space-y-5">
        <div>
          <p className="text-sm text-slate-500">Activez les fonctionnalités disponibles dans votre restaurant.</p>
          <p className="mt-1 text-xs text-slate-400">Cette configuration est réservée au gérant et à l’administrateur.</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block text-sm font-semibold text-slate-900" htmlFor="site-name">Nom du site</label>
          <p className="mt-1 text-sm text-slate-500">Ce nom sera affiché dans le menu client et dans l’espace de gestion.</p>
          <input
            id="site-name"
            value={siteName}
            onChange={(event) => setSiteName(event.target.value)}
            placeholder="Nom de votre restaurant"
            className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-800 outline-none focus:border-amber-400"
          />
        </div>

        {loading ? (
          <p className="rounded-2xl bg-slate-50 p-5 text-slate-500">Chargement de la configuration...</p>
        ) : (
          <div className="space-y-3">
            {configurableFeatures.map((feature) => (
              <label key={feature.key} className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <span>
                  <span className="block font-semibold text-slate-900">{feature.label}</span>
                  <span className="mt-1 block text-sm text-slate-500">{feature.description}</span>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(features[feature.key])}
                  onChange={(event) => setFeatures((current) => ({ ...current, [feature.key]: event.target.checked }))}
                  className="h-5 w-5 shrink-0 accent-amber-500"
                />
              </label>
            ))}
          </div>
        )}

        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}

        <button type="button" onClick={() => void saveSettings()} disabled={loading || saving} className="rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? 'Enregistrement...' : 'Enregistrer la configuration'}
        </button>
      </div>
    </AdminShell>
  );
}

function AdminRoute({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [closingView, setClosingView] = useState(false);
  const [viewError, setViewError] = useState('');
  const token = getToken();
  if (!token) {
    return <Navigate to="/login" replace state={{ returnTo: `${location.pathname}${location.search}` }} />;
  }

  const restaurantId = sessionStorage.getItem('adminViewRestaurantId');
  const restaurantName = sessionStorage.getItem('adminViewRestaurantName') || 'restaurant partenaire';
  const closePartnerView = async () => {
    if (!restaurantId || closingView) return;
    setClosingView(true);
    setViewError('');
    try {
      await axios.post(`${API_BASE_URL}/admin/partner-view/close`, {
        restaurant_id: Number(restaurantId),
      }, { headers: withAuth() });
      sessionStorage.removeItem('adminViewRestaurantId');
      sessionStorage.removeItem('adminViewRestaurantName');
      navigate('/admin?section=restaurants', { replace: true });
    } catch (requestError) {
      console.error('Impossible de journaliser la fermeture du mode administrateur.', requestError);
      setViewError('La consultation ne peut pas être fermée pour le moment. Réessayez.');
    } finally {
      setClosingView(false);
    }
  };

  return (
    <>
      {restaurantId && (
        <div className="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 px-4 py-3 shadow-md sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold text-amber-950">
              MODE ADMINISTRATEUR – Vous consultez actuellement l’espace de {restaurantName}.
            </p>
            <button
              type="button"
              onClick={() => void closePartnerView()}
              disabled={closingView}
              className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold uppercase tracking-wide text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {closingView ? 'Fermeture...' : 'Fermer le tableau de bord partenaire'}
            </button>
            {viewError && <p role="alert" className="w-full text-sm font-medium text-rose-800">{viewError}</p>}
          </div>
        </div>
      )}
      {children}
    </>
  );
}

function GlobalAdminRoute({ children }: { children: ReactNode }) {
  if (sessionStorage.getItem('adminViewRestaurantId')) {
    return <Navigate to="/admin/partner-view" replace />;
  }

  if (sessionStorage.getItem('staffRole') !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <AdminRoute>{children}</AdminRoute>;
}

function PartnerAdminViewRoute() {
  if (
    sessionStorage.getItem('staffRole') !== 'admin'
    || !sessionStorage.getItem('adminViewRestaurantId')
  ) {
    return <Navigate to="/admin?section=restaurants" replace />;
  }

  return <AdminRoute><DashboardRouter /></AdminRoute>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/scan" element={<QRScannerPage />} />
      <Route path="/restaurant/menu/:token" element={<ClientMenuPage />} />
      <Route path="/restaurant/menu/:token/order" element={<ClientOrderPage />} />
      <Route path="/restaurant/menu/:token/status" element={<ClientOrderStatusPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<AdminRoute><DashboardRouter /></AdminRoute>} />
      <Route path="/admin" element={<GlobalAdminRoute><AdminGeneralDashboard /></GlobalAdminRoute>} />
      <Route path="/admin/partner-view" element={<PartnerAdminViewRoute />} />
      <Route path="/qr-display" element={<AdminRoute><AdminShell title="Codes QR des tables"><AdminQRDisplayPage /></AdminShell></AdminRoute>} />
      <Route path="/tables" element={<AdminRoute><TablesPage /></AdminRoute>} />
      <Route path="/menu" element={<AdminRoute><MenuPage /></AdminRoute>} />
      <Route path="/orders/:orderId" element={<AdminRoute><OrderDetailPage /></AdminRoute>} />
      <Route path="/orders" element={<AdminRoute><OrdersPage /></AdminRoute>} />
      <Route path="/kitchen" element={<AdminRoute><KitchenPage /></AdminRoute>} />
      <Route path="/inventory" element={<AdminRoute><InventoryPage /></AdminRoute>} />
      <Route path="/reservations" element={<AdminRoute><ReservationsPage /></AdminRoute>} />
      <Route path="/reports" element={<AdminRoute><ReportsPage /></AdminRoute>} />
      <Route path="/configuration" element={<AdminRoute><ConfigurationPage /></AdminRoute>} />
      <Route path="/" element={<AdminRoute><HomeQRPage /></AdminRoute>} />
      <Route path="*" element={<Navigate to="/scan" replace />} />
    </Routes>
  );
}
