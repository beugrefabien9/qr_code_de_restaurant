<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Menu;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;

class MenuController extends Controller
{
    public function index()
    {
        $menus = Menu::query()
            ->with(['restaurant:id,name', 'categories.products'])
            ->withCount('categories')
            ->orderBy('name')
            ->get();

        return response()->json($menus->map(fn (Menu $menu) => $this->serializeMenu($menu)));
    }

    public function store(Request $request)
    {
        $restaurantId = $this->restaurantIdForRequest($request);
        $validated = $request->validate($this->rules($request, $restaurantId, true));

        if (! $request->hasFile('image') && ! empty($validated['image_url'])) {
            $this->validateRemoteImageUrl($validated['image_url']);
        }

        $imageUrl = $this->storeImage($request);
        $menu = Menu::create([
            'restaurant_id' => $restaurantId,
            'name' => trim($validated['name']),
            'description' => $validated['description'] ?? null,
            'price' => $validated['price'],
            'image_url' => $imageUrl ?? ($validated['image_url'] ?? null),
        ]);
        $menu->categories()->sync($validated['category_ids'] ?? []);

        $this->recordAdminAction($request, $menu, 'menu.created');

        return response()->json($this->serializeMenu($menu->fresh(['restaurant:id,name', 'categories.products'])), 201);
    }

    public function show(Menu $menu)
    {
        return response()->json($this->serializeMenu($menu->load(['restaurant:id,name', 'categories.products'])));
    }

    public function update(Request $request, Menu $menu)
    {
        $validated = $request->validate($this->rules($request, (int) $menu->restaurant_id, false));

        if (array_key_exists('restaurant_id', $validated) && (int) $validated['restaurant_id'] !== (int) $menu->restaurant_id) {
            throw ValidationException::withMessages([
                'restaurant_id' => ['Un menu ne peut pas être déplacé vers un autre restaurant.'],
            ]);
        }

        if (! $request->hasFile('image') && ! ($validated['remove_image'] ?? false) && ! empty($validated['image_url'])) {
            $this->validateRemoteImageUrl($validated['image_url']);
        }

        $previousImageUrl = $menu->image_url;
        $newImageUrl = null;

        if ($request->hasFile('image')) {
            $newImageUrl = $this->storeImage($request);
        } elseif (($validated['remove_image'] ?? false) || array_key_exists('image_url', $validated)) {
            $newImageUrl = ($validated['remove_image'] ?? false) ? null : ($validated['image_url'] ?: null);
        }

        $menu->name = trim($validated['name'] ?? $menu->name);
        if (array_key_exists('description', $validated)) {
            $menu->description = $validated['description'];
        }
        if (array_key_exists('price', $validated)) {
            $menu->price = $validated['price'];
        }
        if ($request->hasFile('image') || ($validated['remove_image'] ?? false) || array_key_exists('image_url', $validated)) {
            $menu->image_url = $newImageUrl;
        }
        $menu->save();

        if ($previousImageUrl !== $menu->image_url) {
            $this->deleteStoredImage($previousImageUrl);
        }

        if (array_key_exists('category_ids', $validated)) {
            $menu->categories()->sync($validated['category_ids'] ?? []);
        }

        $this->recordAdminAction($request, $menu, 'menu.updated');

        return response()->json($this->serializeMenu($menu->fresh(['restaurant:id,name', 'categories.products'])));
    }

    public function destroy(Request $request, Menu $menu)
    {
        $restaurantId = $menu->restaurant_id;
        $imageUrl = $menu->image_url;
        $menuName = $menu->name;
        $menu->delete();
        $this->deleteStoredImage($imageUrl);

        if ($request->user()->isGlobalAdmin()) {
            AuditLog::create([
                'actor_id' => $request->user()->id,
                'restaurant_id' => $restaurantId,
                'action' => 'menu.deleted',
                'target_type' => Menu::class,
                'target_id' => $menu->id,
                'metadata' => ['name' => $menuName],
            ]);
        }

        return response()->json(null, 204);
    }

    private function rules(Request $request, int $restaurantId, bool $creating): array
    {
        $rules = [
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'price' => [$creating ? 'required' : 'sometimes', 'nullable', 'numeric', 'min:0'],
            'image_url' => [
                'exclude_with:image',
                'sometimes',
                'nullable',
                'url:http,https',
                'max:2048',
            ],
            'image' => ['sometimes', 'nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'remove_image' => ['sometimes', 'boolean'],
            'category_ids' => ['sometimes', 'array'],
            'category_ids.*' => [
                'integer',
                Rule::exists('categories', 'id')->where('restaurant_id', $restaurantId),
            ],
        ];

        if ($request->user()->isGlobalAdmin() && $creating) {
            $rules['restaurant_id'] = ['required', 'integer', Rule::exists('restaurants', 'id')];
        } elseif (! $creating) {
            $rules['restaurant_id'] = ['sometimes', 'integer', Rule::exists('restaurants', 'id')];
        } else {
            $rules['restaurant_id'] = ['sometimes', 'integer'];
        }

        return $rules;
    }

    private function restaurantIdForRequest(Request $request): int
    {
        $user = $request->user();
        if ($user->isGlobalAdmin()) {
            $validated = $request->validate([
                'restaurant_id' => ['required', 'integer', Rule::exists('restaurants', 'id')],
            ]);

            return (int) $validated['restaurant_id'];
        }

        abort_unless($user->restaurant_id, 403, 'Aucun restaurant n’est associé à ce compte.');
        if ($request->filled('restaurant_id') && (int) $request->input('restaurant_id') !== (int) $user->restaurant_id) {
            abort(403, 'Vous ne pouvez pas accéder aux données d’un autre restaurant.');
        }

        return (int) $user->restaurant_id;
    }

    private function validateRemoteImageUrl(string $url): void
    {
        $parts = parse_url($url);
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (! in_array($parts['scheme'] ?? null, ['http', 'https'], true)
            || $host === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || in_array($host, ['localhost', 'metadata.google.internal'], true)
            || str_ends_with($host, '.local')
            || str_ends_with($host, '.internal')) {
            throw ValidationException::withMessages([
                'image_url' => ['Indiquez une adresse web publique vers une image.'],
            ]);
        }

        $resolvedAddresses = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : $this->resolvePublicAddresses($host);
        if ($resolvedAddresses === []) {
            throw ValidationException::withMessages([
                'image_url' => ['Le serveur de l’image est inaccessible ou ne possède pas d’adresse publique.'],
            ]);
        }

        foreach ($resolvedAddresses as $address) {
            if (! filter_var($address, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                throw ValidationException::withMessages([
                    'image_url' => ['L’adresse de l’image doit pointer vers un serveur public.'],
                ]);
            }
        }

        try {
            $response = Http::timeout(5)
                ->withOptions(['allow_redirects' => false, 'stream' => true])
                ->get($url);
        } catch (ConnectionException) {
            throw ValidationException::withMessages([
                'image_url' => ['Impossible de vérifier l’image à cette adresse.'],
            ]);
        }

        $contentLength = (int) $response->header('Content-Length', 0);
        $body = $response->toPsrResponse()->getBody();
        $contents = $body->read(5 * 1024 * 1024 + 1);
        $body->close();
        $imageInfo = $contents === '' ? false : @getimagesizefromstring($contents);
        $allowedImageTypes = [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP];

        if (! $response->successful()
            || ($contentLength > 5 * 1024 * 1024)
            || strlen($contents) > 5 * 1024 * 1024
            || ! $imageInfo
            || ! in_array($imageInfo[2], $allowedImageTypes, true)) {
            throw ValidationException::withMessages([
                'image_url' => ['L’adresse indiquée ne renvoie pas une image accessible.'],
            ]);
        }
    }

    private function resolvePublicAddresses(string $host): array
    {
        $addresses = [];
        foreach (dns_get_record($host, DNS_A | DNS_AAAA) ?: [] as $record) {
            $address = $record['ip'] ?? $record['ipv6'] ?? null;
            if (is_string($address)) {
                $addresses[] = $address;
            }
        }

        return array_values(array_unique($addresses));
    }

    private function storeImage(Request $request): ?string
    {
        if (! $request->hasFile('image')) {
            return null;
        }

        $imagePath = $request->file('image')->store('menus', 'public');
        if (! $imagePath) {
            throw new RuntimeException('Le stockage de l’image du menu a échoué.');
        }

        return '/storage/'.$imagePath;
    }

    private function deleteStoredImage(?string $imageUrl): void
    {
        if ($imageUrl && str_starts_with($imageUrl, '/storage/menus/')) {
            Storage::disk('public')->delete(substr($imageUrl, strlen('/storage/')));
        }
    }

    private function serializeMenu(Menu $menu): array
    {
        return [
            'id' => $menu->id,
            'restaurant_id' => $menu->restaurant_id,
            'restaurant_name' => $menu->restaurant?->name,
            'name' => $menu->name,
            'description' => $menu->description,
            'price' => $menu->price === null ? null : (float) $menu->price,
            'image_url' => $menu->image_url,
            'categories_count' => $menu->categories_count ?? $menu->categories->count(),
            'products_count' => $menu->categories->sum(fn (Category $category) => $category->products->count()),
            'categories' => $menu->categories->map(fn (Category $category) => [
                'id' => $category->id,
                'name' => $category->name,
                'products' => $category->products->map(fn ($product) => [
                    'id' => $product->id,
                    'name' => $product->name,
                    'price' => (float) $product->price,
                    'image_url' => $product->image_url,
                    'is_available' => (bool) $product->is_available,
                    'is_active' => (bool) $product->is_active,
                ])->values(),
            ])->values(),
            'created_at' => $menu->created_at,
            'updated_at' => $menu->updated_at,
        ];
    }

    private function recordAdminAction(Request $request, Menu $menu, string $action): void
    {
        if (! $request->user()->isGlobalAdmin()) {
            return;
        }

        AuditLog::create([
            'actor_id' => $request->user()->id,
            'restaurant_id' => $menu->restaurant_id,
            'action' => $action,
            'target_type' => Menu::class,
            'target_id' => $menu->id,
            'metadata' => ['name' => $menu->name],
        ]);
    }
}
