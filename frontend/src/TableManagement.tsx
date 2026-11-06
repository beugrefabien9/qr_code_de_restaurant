import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './api';

const getToken = () => sessionStorage.getItem('accessToken');

const withAuth = () => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

type Table = {
  id: number;
  number: number;
  capacity: number;
  status: 'free' | 'occupied' | 'reserved' | 'unavailable';
  qr_code: string;
  restaurant: number;
  restaurant_name: string;
  is_active: boolean;
  last_action_by_name?: string;
};

type TableForm = {
  number: string;
  capacity: string;
  status: Table['status'];
};

const statusLabels: Record<string, string> = {
  free: 'Libre',
  occupied: 'Occupée',
  reserved: 'Réservée',
  unavailable: 'Indisponible',
};

const statusColors: Record<string, string> = {
  free: 'bg-green-100 text-green-800 border-green-300',
  occupied: 'bg-red-100 text-red-800 border-red-300',
  reserved: 'bg-blue-100 text-blue-800 border-blue-300',
  unavailable: 'bg-gray-100 text-gray-800 border-gray-300',
};

const statusButtonColors: Record<string, string> = {
  free: 'bg-green-500 hover:bg-green-600',
  occupied: 'bg-orange-500 hover:bg-orange-600',
  reserved: 'bg-blue-500 hover:bg-blue-600',
  unavailable: 'bg-gray-500 hover:bg-gray-600',
};

const scrollbarStyles = `
  .scrollbar-custom::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  .scrollbar-custom::-webkit-scrollbar-track {
    background: transparent;
  }
  .scrollbar-custom::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 5px;
  }
  .scrollbar-custom::-webkit-scrollbar-thumb:hover {
    background: #94a3b8;
  }
  .dark .scrollbar-custom::-webkit-scrollbar-thumb {
    background: #475569;
  }
  .dark .scrollbar-custom::-webkit-scrollbar-thumb:hover {
    background: #64748b;
  }
`;

export function TableManagement() {
  const [tables, setTables] = useState<Table[]>([]);
  const [restaurantId, setRestaurantId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [releasingTableId, setReleasingTableId] = useState<number | null>(null);
  const [savingTable, setSavingTable] = useState(false);
  const [deletingTableId, setDeletingTableId] = useState<number | null>(null);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [tableFormOpen, setTableFormOpen] = useState(false);
  const [tableForm, setTableForm] = useState<TableForm>({ number: '', capacity: '2', status: 'free' });
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('restaurant-theme') === 'dark');
  const tablesRequestInProgress = useRef(false);

  useEffect(() => {
    loadTables();
    const timer = setInterval(loadTables, 10000);
    
    // Listen for dark mode changes
    const handleStorageChange = () => {
      setIsDarkMode(localStorage.getItem('restaurant-theme') === 'dark');
    };
    window.addEventListener('storage', handleStorageChange);
    
    // Also watch for manual dark mode toggles
    const observer = new MutationObserver(() => {
      setIsDarkMode(localStorage.getItem('restaurant-theme') === 'dark');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    
    return () => {
      clearInterval(timer);
      window.removeEventListener('storage', handleStorageChange);
      observer.disconnect();
    };
  }, []);

  const loadTables = async () => {
    if (tablesRequestInProgress.current) return;
    tablesRequestInProgress.current = true;
    try {
      const [tablesResponse, restaurantsResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/tables/`, { headers: withAuth() }),
        axios.get(`${API_BASE_URL}/restaurants/`, { headers: withAuth() }),
      ]);
      const data = Array.isArray(tablesResponse.data) ? tablesResponse.data : tablesResponse.data.results || [];
      const restaurants = Array.isArray(restaurantsResponse.data)
        ? restaurantsResponse.data
        : restaurantsResponse.data.results || [];
      setTables(data);
      setRestaurantId(data[0]?.restaurant ?? restaurants[0]?.id ?? null);
      setError(null);
    } catch (err) {
      console.error('Erreur lors du chargement des tables:', err);
      setError('Impossible de charger les tables');
    } finally {
      setLoading(false);
      tablesRequestInProgress.current = false;
    }
  };

  const releaseTable = async (tableId: number) => {
    setReleasingTableId(tableId);
    try {
      const response = await axios.patch(
        `${API_BASE_URL}/tables/${tableId}/`,
        { status: 'free' },
        { headers: withAuth() },
      );
      setTables(tables.map(t => (t.id === tableId ? response.data : t)));
    } catch (err) {
      console.error('Erreur lors de la libération de la table:', err);
      alert('Erreur lors de la libération de la table');
    } finally {
      setReleasingTableId(null);
    }
  };

  const setTableStatus = async (tableId: number, newStatus: string) => {
    try {
      const response = await axios.patch(
        `${API_BASE_URL}/tables/${tableId}/`,
        { status: newStatus },
        { headers: withAuth() },
      );
      setTables(tables.map(t => (t.id === tableId ? response.data : t)));
    } catch (err) {
      console.error('Erreur lors du changement de statut:', err);
      alert('Erreur lors du changement de statut');
    }
  };

  const openTableForm = (table?: Table) => {
    setEditingTable(table ?? null);
    setTableForm(table
      ? { number: String(table.number), capacity: String(table.capacity), status: table.status }
      : { number: '', capacity: '2', status: 'free' });
    setTableFormOpen(true);
    setError(null);
  };

  const saveTable = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingTable && !restaurantId) {
      setError('Impossible de déterminer le restaurant auquel rattacher cette table.');
      return;
    }

    setSavingTable(true);
    setError(null);
    const payload = {
      number: Number(tableForm.number),
      capacity: Number(tableForm.capacity),
      status: tableForm.status,
      ...(!editingTable && restaurantId ? { restaurant_id: restaurantId } : {}),
    };

    try {
      if (editingTable) {
        const response = await axios.patch(
          `${API_BASE_URL}/tables/${editingTable.id}/`,
          payload,
          { headers: withAuth() },
        );
        setTables((current) => current.map((table) => table.id === editingTable.id ? response.data : table));
      } else {
        const response = await axios.post(`${API_BASE_URL}/tables/`, payload, { headers: withAuth() });
        setTables((current) => [...current, response.data]);
      }
      setTableFormOpen(false);
      setEditingTable(null);
    } catch (requestError) {
      console.error('Erreur lors de l’enregistrement de la table :', requestError);
      if (axios.isAxiosError(requestError) && requestError.response?.data?.errors) {
        const validationMessages = Object.values(requestError.response.data.errors).flat() as string[];
        setError(validationMessages[0] || 'Les informations de la table sont invalides.');
      } else {
        setError('Impossible d’enregistrer la table. Vérifiez les informations et réessayez.');
      }
    } finally {
      setSavingTable(false);
    }
  };

  const deleteTable = async (table: Table) => {
    const confirmed = window.confirm(
      `Supprimer la table ${table.number} ? Son QR code ne fonctionnera plus et les commandes/réservations existantes ne seront plus associées à cette table.`,
    );
    if (!confirmed) return;

    setDeletingTableId(table.id);
    setError(null);
    try {
      await axios.delete(`${API_BASE_URL}/tables/${table.id}/`, { headers: withAuth() });
      setTables((current) => current.filter((item) => item.id !== table.id));
    } catch (requestError) {
      console.error('Erreur lors de la suppression de la table :', requestError);
      setError('Impossible de supprimer cette table. Réessayez.');
    } finally {
      setDeletingTableId(null);
    }
  };

  const filteredTables = filterStatus === 'all' ? tables : tables.filter(t => t.status === filterStatus);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className={`${isDarkMode ? 'text-white' : 'text-gray-600'}`}>Chargement des tables...</p>
      </div>
    );
  }

  return (
    <>
      <style>{scrollbarStyles}</style>
      <div className={`w-full p-6 rounded-lg shadow ${isDarkMode ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
        <div className="mb-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className={`text-2xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Gestion des Tables</h2>
            <button
              type="button"
              onClick={() => openTableForm()}
              disabled={!restaurantId}
              className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Ajouter une table
            </button>
          </div>

          {error && (
            <div className={`mb-4 p-4 rounded ${isDarkMode ? 'bg-red-900/30 text-red-200' : 'bg-red-100 text-red-800'}`}>
              {error}
            </div>
          )}

          {/* Filter buttons */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filterStatus === 'all'
                  ? 'bg-blue-600 text-white'
                  : isDarkMode
                    ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              Toutes ({tables.length})
            </button>
            <button
              onClick={() => setFilterStatus('free')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filterStatus === 'free'
                  ? 'bg-green-600 text-white'
                  : isDarkMode
                    ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              Libres ({tables.filter(t => t.status === 'free').length})
            </button>
            <button
              onClick={() => setFilterStatus('occupied')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filterStatus === 'occupied'
                  ? 'bg-red-600 text-white'
                  : isDarkMode
                    ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              Occupées ({tables.filter(t => t.status === 'occupied').length})
            </button>
            <button
              onClick={() => setFilterStatus('reserved')}
              className={`px-4 py-2 rounded-lg font-medium transition ${
                filterStatus === 'reserved'
                  ? 'bg-blue-600 text-white'
                  : isDarkMode
                    ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                    : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              Réservées ({tables.filter(t => t.status === 'reserved').length})
            </button>
          </div>
        </div>

        {/* Tables grid with custom scrollbar */}
        <div className={`scrollbar-custom max-h-[70vh] overflow-auto rounded-lg p-2 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredTables.map(table => (
              <div
                key={table.id}
                className={`p-4 border-2 rounded-lg transition-all duration-200 ${isDarkMode ? 'bg-gray-700' : 'bg-white'}`}
                style={{
                  borderColor: table.status === 'free' ? '#10b981' : table.status === 'occupied' ? '#ef4444' : '#3b82f6',
                }}
              >
                {/* Table number */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Table {table.number}</h3>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium border ${statusColors[table.status]}`}>
                    {statusLabels[table.status]}
                  </span>
                </div>

                {/* Table info */}
                <div className={`text-sm mb-3 space-y-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                  <p>Capacité: <span className="font-semibold">{table.capacity} pers.</span></p>
                  <p>Restaurant: <span className="font-semibold">{table.restaurant_name}</span></p>
                  <p>Dernière action : <span className="font-semibold">{table.last_action_by_name || 'Aucune action enregistrée'}</span></p>
                </div>

                {/* Actions */}
                <div className={`space-y-2 mt-4 border-t pt-3 ${isDarkMode ? 'border-gray-600' : ''}`}>
                  {table.status === 'occupied' && (
                    <button
                      onClick={() => releaseTable(table.id)}
                      disabled={releasingTableId === table.id}
                      className="w-full px-3 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-medium rounded transition"
                    >
                      {releasingTableId === table.id ? 'Libération...' : 'Libérer la table'}
                    </button>
                  )}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openTableForm(table)}
                      className="flex-1 rounded border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50"
                    >
                      Modifier
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteTable(table)}
                      disabled={deletingTableId === table.id}
                      className="flex-1 rounded border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingTableId === table.id ? 'Suppression...' : 'Supprimer'}
                    </button>
                  </div>

                  {/* Status change buttons */}
                  <div className="flex gap-1 text-xs">
                    {(['free', 'occupied', 'reserved', 'unavailable'] as const).map(status => (
                      <button
                        key={status}
                        onClick={() => setTableStatus(table.id, status)}
                        disabled={table.status === status}
                        className={`flex-1 px-2 py-1.5 rounded text-white font-medium transition disabled:opacity-50 disabled:cursor-not-allowed ${
                          table.status === status
                            ? 'opacity-70 cursor-default'
                            : statusButtonColors[status]
                        }`}
                        title={statusLabels[status]}
                      >
                        {status.charAt(0).toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredTables.length === 0 && (
            <div className="text-center py-8">
              <p className={isDarkMode ? 'text-gray-400' : 'text-gray-500'}>
                {filterStatus === 'all' ? 'Aucune table disponible' : `Aucune table ${statusLabels[filterStatus]}`}
              </p>
            </div>
          )}
        </div>
      </div>
      {tableFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={saveTable}
            className={`w-full max-w-md rounded-2xl p-6 shadow-2xl ${isDarkMode ? 'bg-gray-800 text-white' : 'bg-white text-slate-900'}`}
          >
            <h3 className="text-xl font-bold">{editingTable ? 'Modifier la table' : 'Ajouter une table'}</h3>
            <div className="mt-5 space-y-4">
              <label className="block text-sm font-medium">
                Numéro de table
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={tableForm.number}
                  onChange={(event) => setTableForm((current) => ({ ...current, number: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900"
                />
              </label>
              <label className="block text-sm font-medium">
                Nombre de places
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={tableForm.capacity}
                  onChange={(event) => setTableForm((current) => ({ ...current, capacity: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900"
                />
              </label>
              {editingTable && (
                <label className="block text-sm font-medium">
                  Statut
                  <select
                    value={tableForm.status}
                    onChange={(event) => setTableForm((current) => ({ ...current, status: event.target.value as Table['status'] }))}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900"
                  >
                    {Object.entries(statusLabels).map(([status, label]) => (
                      <option key={status} value={status}>{label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setTableFormOpen(false)}
                disabled={savingTable}
                className={`rounded-lg border px-4 py-2 font-medium ${isDarkMode ? 'border-gray-600 hover:bg-gray-700' : 'border-slate-300 hover:bg-slate-50'}`}
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={savingTable}
                className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingTable ? 'Enregistrement...' : editingTable ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
