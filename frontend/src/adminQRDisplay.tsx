import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import axios from 'axios';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from './api';

type Table = {
  id: number;
  number: number;
  qr_code: string | null;
  status: string;
};

type Restaurant = {
  id: string;
  name: string;
};

const tableStatusLabels: Record<string, string> = {
  free: 'Libre',
  occupied: 'Occupée',
  reserved: 'Réservée',
  unavailable: 'Indisponible',
};

export default function AdminQRDisplayPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const qrRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const configuredQrHost = import.meta.env.VITE_PUBLIC_FRONTEND_HOST?.trim();
  const isLocalBrowser = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const qrHost = configuredQrHost || window.location.host;
  const FRONTEND_BASE_URL = `${window.location.protocol}//${qrHost}`;

  useEffect(() => {
    const loadData = async () => {
      try {
        const token = sessionStorage.getItem('accessToken');
        if (!token) {
          navigate('/login', {
            replace: true,
            state: { returnTo: `${location.pathname}${location.search}` },
          });
          return;
        }

        const headers = { Authorization: `Bearer ${token}` };

        // Load tables
        const tablesRes = await axios.get(`${API_BASE_URL}/tables/`, { headers });
        const tablesData = Array.isArray(tablesRes.data) ? tablesRes.data : tablesRes.data.results || [];
        if (tablesData.length > 0) {
          setTables(tablesData);
          if (tablesData[0].restaurant_name) {
            setRestaurant({ id: String(tablesData[0].restaurant), name: tablesData[0].restaurant_name });
          }
          const requestedTableId = Number(searchParams.get('table'));
          const requestedTable = tablesData.find((table: Table) => table.id === requestedTableId);
          setSelectedTableId((currentTableId) => {
            if (currentTableId && tablesData.some((table: Table) => table.id === currentTableId)) {
              return currentTableId;
            }
            return requestedTable?.id || tablesData[0].id;
          });
        }
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          sessionStorage.removeItem('accessToken');
          sessionStorage.removeItem('refreshToken');
          sessionStorage.removeItem('staffRole');
          sessionStorage.removeItem('staffUser');
          navigate('/login', {
            replace: true,
            state: { returnTo: `${location.pathname}${location.search}` },
          });
          return;
        }
        setError('Erreur lors du chargement des tables');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    void loadData();
    const refreshTimer = window.setInterval(() => void loadData(), 10000);
    return () => window.clearInterval(refreshTimer);
  }, [location.pathname, location.search, navigate, searchParams]);

  const selectedTable = tables.find((t) => t.id === selectedTableId);

  const selectTable = (table: Table) => {
    setSelectedTableId(table.id);
  };

  const qrCodeContent = selectedTable?.qr_code
    ? `${FRONTEND_BASE_URL}/restaurant/menu/${selectedTable.qr_code}?table=${selectedTable.number}`
    : '';

  const handlePrint = () => {
    if (qrRef.current) {
      const printWindow = window.open('', '', 'height=500,width=500');
      if (printWindow) {
        const canvas = qrRef.current.querySelector('canvas');
        if (canvas) {
          const img = canvas.toDataURL('image/png');
          printWindow.document.write(`
            <html><body style="display: flex; align-items: center; justify-content: center; height: 100vh;">
              <div style="text-align: center;">
                <h2>Table ${selectedTable?.number}</h2>
                <img src="${img}" style="width: 300px; height: 300px;">
                <p>${selectedTable?.qr_code}</p>
              </div>
            </body></html>
          `);
          printWindow.document.close();
          printWindow.print();
        }
      }
    }
  };

  return (
    <main className="partner-qr-page">
      <div className="partner-qr-content">
        <header className="partner-qr-page-intro">
          <p className="partner-section-kicker">QR CODES INDIVIDUELS</p>
          <p>Choisissez une table pour afficher ou imprimer son code. Vos clients accéderont directement au menu de cette table.</p>
        </header>

        {error && <p className="mb-4 rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl bg-white p-12">
            <p className="text-slate-600">Chargement des tables...</p>
          </div>
        ) : (
          <div className="partner-qr-layout">
            {/* Table selector */}
            <div className="partner-qr-selector">
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Tables</h2>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {tables.length > 0 ? (
                  tables.map((table) => (
                    <button
                      key={table.id}
                      type="button"
                      onClick={() => selectTable(table)}
                      className={[
                        'w-full rounded-lg px-4 py-2 text-left font-medium transition',
                        selectedTableId === table.id
                          ? 'bg-amber-500 text-white shadow-md'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
                      ].join(' ')}
                    >
                      Table {table.number}
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Aucune table disponible</p>
                )}
              </div>
            </div>

            {/* QR Code Display */}
            <div className="partner-qr-detail">
              {selectedTable ? (
                <div className="flex flex-col items-center">
                  <p className="mb-4 text-sm font-medium text-slate-600">
                    {restaurant?.name || 'Menu du restaurant'}
                  </p>
                  <h3 className="mb-6 text-xl font-bold text-slate-900">Table {selectedTable.number}</h3>

                  {/* QR Code */}
                  <div className="partner-qr-code" ref={qrRef}>
                    {qrCodeContent && (
                      <QRCodeCanvas
                        value={qrCodeContent}
                        size={300}
                        level="H"
                        includeMargin
                        bgColor="#ffffff"
                        fgColor="#0f172a"
                      />
                    )}
                    {!qrCodeContent && <p className="text-sm text-rose-600">Jeton QR indisponible pour cette table.</p>}
                  </div>

                  {/* Info and Controls */}
                  <div className="w-full space-y-3">
                    {isLocalBrowser && !configuredQrHost && (
                      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                        Le QR code est affiché, mais cette adresse locale ne fonctionnera pas depuis un téléphone. Ouvrez l’application avec l’adresse réseau du PC pour générer un QR utilisable par vos clients.
                      </div>
                    )}
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs text-slate-600">Token QR :</p>
                      <p className="mt-1 break-all font-mono text-xs font-medium text-slate-900">
                        {selectedTable.qr_code}
                      </p>
                    </div>

                    <div className="rounded-lg bg-blue-50 p-3">
                      <p className="text-xs text-blue-700">Adresse utilisée par le téléphone :</p>
                      <p className="mt-1 break-all font-mono text-xs font-medium text-blue-900">{qrCodeContent || 'Aucune adresse réseau configurée. Ouvrez cette page depuis l’adresse Wi-Fi du PC.'}</p>
                    </div>

                    <div className="rounded-lg bg-amber-50 p-3">
                      <p className="text-xs text-amber-700">Statut :</p>
                      <p className="mt-1 font-medium text-amber-900">{tableStatusLabels[selectedTable.status] || selectedTable.status}</p>
                    </div>

                    {/* Print button */}
                    <button
                      type="button"
                      onClick={handlePrint}
                      disabled={!qrCodeContent}
                      className="w-full rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Imprimer
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-12">
                  <p className="text-slate-500">Sélectionnez une table pour afficher son code QR</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Test Info */}
        <div className="partner-qr-help">
          <p className="text-sm font-medium text-blue-900">💡 Comment ça marche :</p>
          <ol className="mt-3 list-inside space-y-1 text-sm text-blue-800">
            <li>1. Sélectionnez une table dans la liste</li>
            <li>2. Affichez le code QR sur un écran ou imprimez-le sur la table</li>
            <li>3. Les clients scannent le QR code avec leur téléphone</li>
            <li>4. Le menu s'ouvre directement sur leur appareil</li>
          </ol>
        </div>
      </div>
    </main>
  );
}
