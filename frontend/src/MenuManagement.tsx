import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { API_BASE_URL } from './api';

type MenuCategory = {
  id: number;
  name: string;
  restaurant_id: number;
};

type MenuRecord = {
  id: number;
  restaurant_id: number;
  restaurant_name: string | null;
  name: string;
  description: string | null;
  price: number | null;
  image_url: string | null;
  categories_count: number;
  products_count: number;
  categories: { id: number; name: string; products: { id: number; name: string; price: number }[] }[];
};

type RestaurantOption = { id: number; name: string };

type MenuManagementProps = { isGlobalAdmin?: boolean };

const authHeaders = () => ({
  Authorization: `******'accessToken') || ''}`,
});

const imageSource = (url: string | null) => {
  if (!url) return '';
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return '';
  }
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ message?: string; errors?: Record<string, string[]> }>(error)) {
    const validationMessage = error.response?.data?.errors
      ? Object.values(error.response.data.errors).flat()[0]
      : undefined;
    return validationMessage || error.response?.data?.message || fallback;
  }
  return fallback;
}

export default function MenuManagement({ isGlobalAdmin = false }: MenuManagementProps) {
  const [menus, setMenus] = useState<MenuRecord[]>([]);
  const [restaurants, setRestaurants] = useState<RestaurantOption[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [restaurantId, setRestaurantId] = useState('');
  const [editingMenu, setEditingMenu] = useState<MenuRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [originalImageUrl, setOriginalImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [removeImage, setRemoveImage] = useState(false);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const readOnly = Boolean(sessionStorage.getItem('adminViewRestaurantId'));

  const visibleCategories = useMemo(
    () => categories.filter((category) => !isGlobalAdmin || (Boolean(restaurantId) && category.restaurant_id === Number(restaurantId))),
    [categories, isGlobalAdmin, restaurantId],
  );

  const loadData = async () => {
    setLoading(true);
    setError('');
    try {
      const [menuResponse, categoryResponse] = await Promise.all([
        axios.get<MenuRecord[]>(`${API_BASE_URL}/menus`, { headers: authHeaders() }),
        axios.get<MenuCategory[]>(`${API_BASE_URL}/categories`, { headers: authHeaders() }),
      ]);
      setMenus(Array.isArray(menuResponse.data) ? menuResponse.data : []);
      setCategories(Array.isArray(categoryResponse.data) ? categoryResponse.data : []);
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Impossible de charger les menus et catégories.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadInitialData = async () => {
      try {
        if (isGlobalAdmin) {
          const response = await axios.get<RestaurantOption[]>(`${API_BASE_URL}/restaurants`, { headers: authHeaders() });
          if (!active) return;
          const availableRestaurants = Array.isArray(response.data) ? response.data : [];
          setRestaurants(availableRestaurants);
        }
        await loadData();
      } catch (requestError) {
        if (active) setError(getErrorMessage(requestError, 'Impossible de charger les restaurants.'));
      }
    };
    void loadInitialData();
    return () => { active = false; };
  }, [isGlobalAdmin]);

  useEffect(() => {
    if (!imageFile || !previewUrl.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [imageFile, previewUrl]);

  useEffect(() => {
    if (!isGlobalAdmin || !restaurantId) return;
    setCategoryIds((current) => current.filter((id) => {
      const category = categories.find((item) => item.id === id);
      return category?.restaurant_id === Number(restaurantId);
    }));
  }, [categories, isGlobalAdmin, restaurantId]);

  const resetForm = () => {
    setEditingMenu(null);
    setFormOpen(false);
    setName('');
    setDescription('');
    setPrice('');
    setImageUrl('');
    setOriginalImageUrl('');
    setImageFile(null);
    setPreviewUrl('');
    setRemoveImage(false);
    setCategoryIds([]);
  };

  const startEditing = (menu?: MenuRecord) => {
    setEditingMenu(menu || null);
    setFormOpen(true);
    setName(menu?.name || '');
    setDescription(menu?.description || '');
    setPrice(menu?.price === null || menu?.price === undefined ? '' : String(menu.price));
    setImageUrl(menu?.image_url?.startsWith('http') ? menu.image_url : '');
    setOriginalImageUrl(menu?.image_url || '');
    setImageFile(null);
    setPreviewUrl(menu?.image_url ? imageSource(menu.image_url) : '');
    setRemoveImage(false);
    setCategoryIds(menu?.categories.map((category) => category.id) || []);
    if (menu && isGlobalAdmin) setRestaurantId(String(menu.restaurant_id));
    setNotice('');
    setError('');
  };

  const selectImage = (file?: File) => {
    setError('');
    if (!file) return;
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setImageFile(null);
      setPreviewUrl(imageSource(editingMenu?.image_url || null));
      setError('Choisissez une image JPG, PNG ou WEBP de 5 Mo maximum.');
      return;
    }
    setImageFile(file);
    setImageUrl('');
    setRemoveImage(false);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const saveMenu = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isGlobalAdmin && !restaurantId) {
      setError('Sélectionnez le restaurant propriétaire du menu.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    const payload = new FormData();
    payload.append('name', name.trim());
    payload.append('description', description.trim());
    payload.append('price', price);
    categoryIds.forEach((id) => payload.append('category_ids[]', String(id)));
    if (isGlobalAdmin && !editingMenu) payload.append('restaurant_id', restaurantId);
    if (imageFile) payload.append('image', imageFile);
    else if (imageUrl.trim() && imageUrl.trim() !== originalImageUrl) payload.append('image_url', imageUrl.trim());
    if (removeImage) payload.append('remove_image', '1');
    if (editingMenu) payload.append('_method', 'PATCH');

    try {
      if (editingMenu) {
        await axios.post(`${API_BASE_URL}/menus/${editingMenu.id}`, payload, { headers: authHeaders() });
      } else {
        await axios.post(`${API_BASE_URL}/menus`, payload, { headers: authHeaders() });
      }
      resetForm();
      setNotice(editingMenu ? 'Menu modifié avec succès.' : 'Menu créé avec succès.');
      await loadData();
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Impossible d’enregistrer le menu.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteMenu = async (menu: MenuRecord) => {
    if (!window.confirm(`Supprimer le menu « ${menu.name} » ? Les catégories et produits associés seront conservés.`)) return;
    setError('');
    setNotice('');
    try {
      await axios.delete(`${API_BASE_URL}/menus/${menu.id}`, { headers: authHeaders() });
      setNotice(`Le menu « ${menu.name} » a été supprimé.`);
      await loadData();
    } catch (requestError) {
      setError(getErrorMessage(requestError, 'Impossible de supprimer ce menu.'));
    }
  };

  const filteredMenus = menus.filter((menu) => (
    (!isGlobalAdmin || !restaurantId || menu.restaurant_id === Number(restaurantId))
  ));

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</p>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Menus du restaurant</h2>
            <p className="mt-1 text-sm text-slate-500">Associez des catégories existantes à un ou plusieurs menus.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isGlobalAdmin && (
              <select value={restaurantId} onChange={(event) => { setRestaurantId(event.target.value); resetForm(); }} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" aria-label="Restaurant propriétaire">
                <option value="">Tous les restaurants</option>
                {restaurants.map((restaurant) => <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>)}
              </select>
            )}
            {!readOnly && <button type="button" onClick={() => startEditing()} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-amber-600">
              + Ajouter un menu
            </button>}
          </div>
        </div>

        {formOpen && !readOnly ? (
          <form onSubmit={saveMenu} className="mt-5 grid gap-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold text-slate-900">{editingMenu ? 'Modifier le menu' : 'Créer un menu'}</h3>
              <button type="button" onClick={resetForm} className="text-sm font-semibold text-slate-600">Annuler</button>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Nom du menu
              <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Menu principal, menu déjeuner…" className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Description
              <textarea maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Décrivez ce menu (facultatif)…" className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Prix du menu (XOF)
              <input required type="number" min="0" step="1" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="Ex. 5000" className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                Image locale (JPG, PNG, WEBP · 5 Mo max.)
                <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event) => selectImage(event.target.files?.[0])} className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white p-2 text-sm" />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Ou URL d’image
                <input type="url" value={imageUrl} onChange={(event) => { setImageUrl(event.target.value); setImageFile(null); setPreviewUrl(event.target.value ? imageSource(event.target.value) : ''); setRemoveImage(Boolean(editingMenu?.image_url) && !event.target.value); }} placeholder="https://exemple.com/menu.jpg" className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5" />
              </label>
            </div>
            {previewUrl && (
              <div className="flex flex-wrap items-center gap-3">
                <img src={previewUrl} alt="Aperçu du menu" className="h-24 w-32 rounded-xl border border-slate-200 bg-white object-cover" onError={() => setPreviewUrl('')} />
                <button type="button" onClick={() => { setImageFile(null); setImageUrl(''); setPreviewUrl(''); setRemoveImage(Boolean(editingMenu?.image_url)); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Supprimer l’image</button>
              </div>
            )}
            {editingMenu?.image_url && !previewUrl && (
              <button type="button" onClick={() => setRemoveImage(true)} className="justify-self-start rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700">Supprimer l’image actuelle</button>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-semibold text-slate-700">Catégories et produits associés</legend>
              {visibleCategories.length ? (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleCategories.map((category) => (
                    <label key={category.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                      <input type="checkbox" checked={categoryIds.includes(category.id)} onChange={(event) => setCategoryIds((current) => event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id))} className="accent-amber-500" />
                      {category.name}
                    </label>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-500">Aucune catégorie disponible. Créez d’abord des catégories dans le module correspondant.</p>}
            </fieldset>
            <button type="submit" disabled={saving} className="justify-self-start rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer le menu'}
            </button>
          </form>
        ) : null}
      </section>

      {loading ? <p className="rounded-xl bg-white p-5 text-sm text-slate-500">Chargement des menus…</p> : filteredMenus.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Aucun menu enregistré pour le moment.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredMenus.map((menu) => (
            <article key={menu.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {menu.image_url ? <img src={imageSource(menu.image_url)} alt={menu.name} className="h-40 w-full object-cover" /> : <div className="flex h-40 items-center justify-center bg-slate-100 text-sm text-slate-400">Aucune image</div>}
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-bold text-slate-900">{menu.name}</h3>
                    {isGlobalAdmin && <p className="mt-1 text-xs text-slate-500">{menu.restaurant_name}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold text-amber-700">{menu.price === null ? 'Prix à définir' : `${new Intl.NumberFormat('fr-FR').format(menu.price)} XOF`}</p>
                    <p className="mt-1 text-xs text-slate-500">{menu.products_count} produit(s)</p>
                  </div>
                </div>
                {menu.description && <p className="mt-2 text-sm leading-5 text-slate-600">{menu.description}</p>}
                <div className="mt-3 space-y-2">
                  {menu.categories.map((category) => (
                    <div key={category.id} className="rounded-lg bg-slate-50 p-2.5">
                      <p className="text-sm font-semibold text-slate-700">{category.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{category.products.map((product) => `${product.name} · ${new Intl.NumberFormat('fr-FR').format(product.price)} XOF`).join(' • ') || 'Aucun produit'}</p>
                    </div>
                  ))}
                  {menu.categories.length === 0 && <p className="text-xs text-slate-500">Aucune catégorie associée</p>}
                </div>
                {!readOnly && <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => startEditing(menu)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Modifier</button>
                  <button type="button" onClick={() => void deleteMenu(menu)} className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50">Supprimer</button>
                </div>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
