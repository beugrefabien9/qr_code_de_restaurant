<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use RuntimeException;

class ProductController extends Controller
{
    private function serializeProduct(Product $product): array
    {
        $availableQuantity = (int) ($product->available_quantity ?? $product->stock ?? 0);
        $isAvailable = $product->is_available ?? ($availableQuantity > 0);
        $category = $product->relationLoaded('category')
            ? $product->getRelation('category')
            : ($product->category_id ? $product->category()->first() : null);
        $categoryName = $category?->name ?? $product->category_value ?? 'Plats';

        return [
            'id' => $product->id,
            'restaurant_id' => $product->restaurant_id,
            'category_id' => $product->category_id,
            'name' => $product->name,
            'description' => $product->description,
            'image_url' => $product->image_url,
            'price' => (float) $product->price,
            'stock' => (int) ($product->stock ?? 0),
            'status' => $product->status ?? 'available',
            'category' => $categoryName,
            'category_name' => $categoryName,
            'preparation_time' => (int) ($product->preparation_time ?? 10),
            'available_quantity' => $availableQuantity,
            'is_available' => (bool) $isAvailable,
            'is_active' => (bool) ($product->is_active ?? true),
            'created_at' => $product->created_at,
            'updated_at' => $product->updated_at,
        ];
    }

    public function index()
    {
        $products = Product::with('category')->get();

        return response()->json($products->map(fn (Product $product) => $this->serializeProduct($product)));
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'restaurant_id' => ['nullable', 'exists:restaurants,id'],
            'category_id' => ['nullable', $this->restaurantResourceRule('categories', $request)],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'image_url' => ['nullable', 'url', 'max:2048'],
            'image' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp,gif', 'max:5120'],
            'price' => ['required', 'numeric', 'min:0'],
            'stock' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'string', 'max:50'],
            'category' => ['nullable', 'string', 'max:100'],
            'preparation_time' => ['nullable', 'integer', 'min:1'],
            'available_quantity' => ['nullable', 'integer', 'min:0'],
            'is_available' => ['nullable', 'boolean'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        $validated = $this->assignRestaurant($validated, $request);

        $validated['available_quantity'] = $validated['available_quantity'] ?? $validated['stock'] ?? 1;
        $validated['preparation_time'] = $validated['preparation_time'] ?? 10;
        $validated['is_available'] = $validated['is_available'] ?? ($validated['available_quantity'] > 0);
        $validated['is_active'] = $validated['is_active'] ?? true;

        if ($request->hasFile('image')) {
            $imagePath = $request->file('image')->store('products', 'public');
            if (! $imagePath) {
                throw new RuntimeException('Le stockage de l’image du produit a échoué.');
            }
            $validated['image_url'] = '/storage/'.$imagePath;
        }
        unset($validated['image']);
        unset($validated['remove_image']);

        $product = Product::create($validated);

        return response()->json($this->serializeProduct($product->fresh(['restaurant', 'category'])), 201);
    }

    public function show(Product $product)
    {
        return response()->json($this->serializeProduct($product->load(['restaurant', 'category'])));
    }

    public function update(Request $request, Product $product)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'exists:restaurants,id'],
            'category_id' => ['nullable', $this->restaurantResourceRule('categories', $request)],
            'name' => ['sometimes', 'string', 'max:255'],
            'description' => ['nullable', 'string'],
            'image_url' => ['sometimes', 'nullable', 'url', 'max:2048'],
            'image' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp,gif', 'max:5120'],
            'remove_image' => ['sometimes', 'boolean'],
            'price' => ['sometimes', 'numeric', 'min:0'],
            'stock' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'string', 'max:50'],
            'category' => ['nullable', 'string', 'max:100'],
            'preparation_time' => ['nullable', 'integer', 'min:1'],
            'available_quantity' => ['nullable', 'integer', 'min:0'],
            'is_available' => ['nullable', 'boolean'],
            'is_active' => ['nullable', 'boolean'],
        ]);

        if (array_key_exists('available_quantity', $validated)) {
            $validated['available_quantity'] = max(0, (int) $validated['available_quantity']);
        }

        if (array_key_exists('stock', $validated) && ! array_key_exists('available_quantity', $validated)) {
            $validated['available_quantity'] = $validated['stock'];
        }

        if (array_key_exists('is_available', $validated) && ! array_key_exists('available_quantity', $validated)) {
            $validated['available_quantity'] = $product->available_quantity ?? 0;
        }

        if ($request->hasFile('image')) {
            $imagePath = $request->file('image')->store('products', 'public');
            if (! $imagePath) {
                throw new RuntimeException('Le stockage de l’image du produit a échoué.');
            }
            $this->deleteStoredImage($product->image_url);
            $validated['image_url'] = '/storage/'.$imagePath;
        } elseif (($validated['remove_image'] ?? false) === true || ($validated['remove_image'] ?? null) === '1') {
            $this->deleteStoredImage($product->image_url);
            $validated['image_url'] = null;
        } elseif (array_key_exists('image_url', $validated) && $validated['image_url'] !== $product->image_url) {
            $this->deleteStoredImage($product->image_url);
        }
        unset($validated['image']);
        unset($validated['remove_image']);

        $product->update($validated);

        return response()->json($this->serializeProduct($product->fresh(['restaurant', 'category'])));
    }

    public function destroy(Product $product)
    {
        $this->deleteStoredImage($product->image_url);
        $product->delete();

        return response()->json(null, 204);
    }

    private function deleteStoredImage(?string $imageUrl): void
    {
        if ($imageUrl && str_starts_with($imageUrl, '/storage/')) {
            Storage::disk('public')->delete(substr($imageUrl, strlen('/storage/')));
        }
    }
}
