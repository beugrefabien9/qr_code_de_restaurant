<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Product;
use App\Models\Table;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PublicMenuController extends Controller
{
    public function orderStatus(Request $request, int $order)
    {
        $validated = $request->validate([
            'token' => ['required', 'string'],
        ]);
        $order = Order::query()
            ->whereKey($order)
            ->whereHas('table', fn ($query) => $query->where('qr_token', $validated['token']))
            ->whereHas('restaurant', fn ($query) => $query->where('status', 'active'))
            ->firstOrFail();

        return response()->json([
            'id' => $order->id,
            'status' => $order->status,
        ]);
    }

    public function menu(string $token)
    {
        $table = Table::with('restaurant.products.category')->where('qr_token', $token)->first();

        if (! $table || ! $table->restaurant || $table->restaurant->status !== 'active') {
            return response()->json([
                'detail' => 'Ce QR code ne correspond à aucune table.',
            ], 404);
        }

        $restaurant = $table->restaurant;

        $products = $restaurant->products
            ->filter(fn (Product $product) => $product->is_active && $product->is_available)
            ->map(function (Product $product) {
                $availableQuantity = (int) ($product->available_quantity ?? $product->stock ?? 0);
                $category = $product->relationLoaded('category')
                    ? $product->getRelation('category')
                    : null;

                return [
                    'id' => $product->id,
                    'name' => $product->name,
                    'category_name' => $category?->name ?? $product->category_value ?? 'Plats',
                    'description' => $product->description,
                    'image_url' => $product->image_url,
                    'price' => (float) $product->price,
                    'preparation_time' => (int) ($product->preparation_time ?? 10),
                    'available_quantity' => $availableQuantity,
                    'created_at' => $product->created_at,
                ];
            })->values();

        return response()->json([
            'restaurant' => [
                'id' => $restaurant->id,
                'name' => $restaurant->name,
                'address' => $restaurant->address,
                'phone' => $restaurant->phone,
                'email' => $restaurant->email,
                'city' => $restaurant->city,
            ],
            'table' => [
                'id' => $table->id,
                'number' => $table->number,
                'status' => $table->status === 'available' ? 'free' : $table->status,
            ],
            'products' => $products,
        ]);
    }

    public function placeOrder(Request $request)
    {
        $validated = $request->validate([
            'table_token' => ['required', 'string', 'exists:tables,qr_token'],
            'order_type' => ['required', 'in:dine_in,takeaway'],
            'note' => ['nullable', 'string', 'max:2000'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'integer', 'distinct', 'exists:products,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
            'items.*.note' => ['nullable', 'string', 'max:1000'],
        ]);

        $table = Table::where('qr_token', $validated['table_token'])->firstOrFail();
        abort_unless($table->restaurant?->status === 'active', 404, 'Ce restaurant n’est pas disponible.');

        $order = DB::transaction(function () use ($validated, $table): Order {
            $order = Order::create([
                'restaurant_id' => $table->restaurant_id,
                'table_id' => $validated['order_type'] === 'dine_in' ? $table->id : null,
                'customer_name' => 'Client',
                'order_type' => $validated['order_type'],
                'note' => $validated['note'] ?? null,
                'status' => 'pending',
                'total_amount' => 0,
            ]);

            $total = 0;
            foreach ($validated['items'] as $item) {
                $product = Product::query()
                    ->where('restaurant_id', $table->restaurant_id)
                    ->whereKey($item['product_id'])
                    ->lockForUpdate()
                    ->first();

                if (! $product || ! $product->is_active || ! $product->is_available) {
                    throw ValidationException::withMessages([
                        'items' => ['Un des produits sélectionnés n’est plus disponible.'],
                    ]);
                }

                $quantity = (int) $item['quantity'];
                $availableQuantity = (int) ($product->available_quantity ?? $product->stock ?? 0);
                if ($availableQuantity < $quantity) {
                    throw ValidationException::withMessages([
                        'items' => ["Stock insuffisant pour le produit {$product->name}."],
                    ]);
                }

                $unitPrice = (float) $product->price;
                $lineTotal = $unitPrice * $quantity;
                $total += $lineTotal;

                $order->items()->create([
                    'product_id' => $product->id,
                    'quantity' => $quantity,
                    'unit_price' => $unitPrice,
                    'total_price' => $lineTotal,
                    'note' => $item['note'] ?? null,
                ]);

                $product->available_quantity = $availableQuantity - $quantity;
                $product->save();
            }

            $order->update(['total_amount' => $total]);

            return $order;
        });

        return response()->json([
            'id' => $order->id,
            'status' => $order->status,
            'order_type' => $order->order_type,
            'total_amount' => (float) $order->total_amount,
        ], 201);
    }
}
