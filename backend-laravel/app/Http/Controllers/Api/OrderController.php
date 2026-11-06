<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OrderController extends Controller
{
    private function serializeOrder(Order $order): array
    {
        return [
            'id' => $order->id,
            'restaurant_id' => $order->restaurant_id,
            'table_id' => $order->table_id,
            'table' => $order->table?->number,
            'customer_name' => $order->customer_name,
            'order_type' => $order->order_type ?? 'dine_in',
            'note' => $order->note,
            'status' => $order->status,
            'served_at' => $order->served_at,
            'total_amount' => (float) ($order->total_amount ?? 0),
            'created_at' => $order->created_at,
            'updated_at' => $order->updated_at,
            'items' => $order->items->map(function ($item) {
                return [
                    'id' => $item->id,
                    'product' => $item->product_id,
                    'product_name' => $item->product?->name ?? 'Produit',
                    'quantity' => (int) $item->quantity,
                    'unit_price' => (float) $item->unit_price,
                    'total_price' => (float) $item->total_price,
                    'note' => $item->note,
                ];
            })->values()->all(),
        ];
    }

    public function index()
    {
        $orders = Order::with(['restaurant', 'table', 'items.product'])->get();

        return response()->json($orders->map(fn (Order $order) => $this->serializeOrder($order)));
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'integer'],
            'table_id' => ['nullable', $this->restaurantResourceRule('tables', $request)],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'string', 'max:50'],
            'total_amount' => ['nullable', 'numeric', 'min:0'],
        ]);
        $validated = $this->assignRestaurant($validated, $request);

        $order = Order::create($validated);

        return response()->json($this->serializeOrder($order->load(['table', 'items.product'])), 201);
    }

    public function show(Order $order)
    {
        return response()->json($this->serializeOrder($order->load(['restaurant', 'table', 'items.product'])));
    }

    public function update(Request $request, Order $order)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'exists:restaurants,id'],
            'table_id' => ['nullable', $this->restaurantResourceRule('tables', $request)],
            'customer_name' => ['nullable', 'string', 'max:255'],
            'status' => ['nullable', 'string', 'max:50'],
            'total_amount' => ['nullable', 'numeric', 'min:0'],
        ]);

        $order->update($validated);

        return response()->json($this->serializeOrder($order->fresh(['table', 'items.product'])));
    }

    public function transition(Order $order)
    {
        $order = DB::transaction(function () use ($order) {
            $lockedOrder = Order::query()->lockForUpdate()->findOrFail($order->getKey());
            $currentStatus = $lockedOrder->status ?? 'pending';
            $nextStatusByCurrentStatus = [
                'pending' => 'preparing',
                'confirmed' => 'preparing',
                'preparing' => 'ready',
                'ready' => 'served',
            ];

            if (! isset($nextStatusByCurrentStatus[$currentStatus])) {
                throw ValidationException::withMessages([
                    'status' => "La commande ne peut pas avancer depuis le statut « {$currentStatus} ».",
                ]);
            }

            $lockedOrder->status = $nextStatusByCurrentStatus[$currentStatus];
            if ($lockedOrder->status === 'served') {
                $lockedOrder->served_at ??= now();
            }
            $lockedOrder->save();

            return $lockedOrder;
        });

        return response()->json($this->serializeOrder($order->fresh(['table', 'items.product'])));
    }

    public function destroy(Order $order)
    {
        $order->delete();

        return response()->json(null, 204);
    }
}
