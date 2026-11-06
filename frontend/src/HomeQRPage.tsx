import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import axios from 'axios';
import { API_BASE_URL } from './api';

type Table = {
  id: number;
  number: number;
  qr_code: string | null;
  status: string;
  restaurant_id: number;
  restaurant_name?: string;
};

const tableStatusLabels: Record<string, string> = {
  free: 'Libre',
  available: 'Libre',
  occupied: 'Occupée',
  reserved: 'Réservée',
  unavailable: 'Indisponible',
};

export default function HomeQRPage() {
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const configuredQrHost = import.meta.env.VITE_PUBLIC_FRONTEND_HOST?.trim();
  const isLocalBrowser = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const qrHost = configuredQrHost || window.location.host;
  const frontendUrl = `${window.location.protocol}//${qrHost}`;
  const restaurantName = tables[0]?.restaurant_name || 'Restaurant';
  const selectedTable = tables.find((table) => table.id === selectedTableId) || tables[0];
  const menuUrl = selectedTable?.qr_code
    ? `${frontendUrl}/restaurant/menu/${selectedTable.qr_code}?table=${selectedTable.number}`
    : '';

  useEffect(() => {
    let active = true;

    const loadTables = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/tables/`);
        const data: Table[] = Array.isArray(response.data)
          ? response.data
          : response.data.results || [];

        if (active) {
          setTables(data);
          setSelectedTableId((currentId) => (
            currentId && data.some((table) => table.id === currentId)
              ? currentId
              : data[0]?.id ?? null
          ));
          setError('');
        }
      } catch (requestError) {
        console.error('Impossible de charger les tables Laravel.', requestError);
        if (active) setError('Impossible de charger les tables. Vérifiez que Laravel est démarré puis réessayez.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadTables();
    const timer = window.setInterval(() => void loadTables(), 10000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <main className="qr-home min-h-screen bg-slate-100 p-4">
      <style>{`
        @media print {
          body { background: white !important; }
          .qr-home { padding: 0 !important; background: white !important; }
          .qr-home-description, .qr-print-button, .qr-phone-warning, .qr-table-list, .qr-url { display: none !important; }
          .qr-layout { display: block !important; }
          .qr-panel { border: 0 !important; box-shadow: none !important; }
          .qr-code { width: 300px !important; height: 300px !important; }
        }
      `}</style>
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">Accueil</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">{restaurantName} · QR des tables</h1>
            <p className="qr-home-description mt-2 text-sm text-slate-600">
              Scannez le code de votre table pour ouvrir le menu et commander.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!selectedTable}
            className="qr-print-button rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Imprimer le QR de cette table
          </button>
        </header>

        {isLocalBrowser && !configuredQrHost && (
          <div className="qr-phone-warning mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
            Pour scanner les codes depuis un téléphone, ouvrez cette page avec l’adresse réseau du PC. Les QR codes utilisent actuellement {qrHost}.
          </div>
        )}

        {error && <p className="mb-4 rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>}

        {loading ? (
          <div className="rounded-2xl bg-white p-12 text-center text-slate-600">Chargement des tables...</div>
        ) : tables.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">Aucune table pour le moment</h2>
            <p className="mt-2 text-slate-600">Ajoutez des tables dans Laravel pour afficher leurs codes QR ici.</p>
          </div>
        ) : (
          <div className="qr-layout grid min-h-[34rem] overflow-hidden rounded-2xl bg-white shadow-sm md:grid-cols-[minmax(15rem,0.8fr)_2fr]">
            <aside className="qr-table-list border-b border-slate-200 p-5 md:border-b-0 md:border-r">
              <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-500">Liste des tables</h2>
              <nav aria-label="Choisir une table" className="space-y-2">
                {tables.map((table) => {
                  const isSelected = table.id === selectedTable?.id;
                  return (
                    <button
                      key={table.id}
                      type="button"
                      aria-current={isSelected ? 'true' : undefined}
                      onClick={() => setSelectedTableId(table.id)}
                      className={[
                        'flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition',
                        isSelected
                          ? 'border-amber-500 bg-amber-50 text-amber-900'
                          : 'border-transparent bg-slate-50 text-slate-700 hover:border-slate-200 hover:bg-slate-100',
                      ].join(' ')}
                    >
                      <span className="font-semibold">Table {table.number}</span>
                      <span className="text-xs text-slate-500">{tableStatusLabels[table.status] || table.status}</span>
                    </button>
                  );
                })}
              </nav>
            </aside>

            <section className="qr-panel flex flex-col items-center justify-center p-6 text-center md:p-10" aria-live="polite">
              {selectedTable && (
                <>
                  <p className="text-sm font-medium text-slate-500">{selectedTable.restaurant_name || restaurantName}</p>
                  <h2 className="mt-2 text-3xl font-bold text-slate-900">Table {selectedTable.number}</h2>
                  <span className="mt-3 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                    {tableStatusLabels[selectedTable.status] || selectedTable.status}
                  </span>
                  <div className="qr-code mt-6 flex h-72 w-72 items-center justify-center rounded-2xl border border-slate-200 bg-white p-3">
                    {menuUrl
                      ? <QRCodeCanvas value={menuUrl} size={264} level="H" includeMargin bgColor="#ffffff" fgColor="#0f172a" />
                      : <p className="text-sm text-rose-600">Jeton QR indisponible</p>}
                  </div>
                  <p className="qr-url mt-4 max-w-xl break-all text-xs text-slate-500">{menuUrl}</p>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
