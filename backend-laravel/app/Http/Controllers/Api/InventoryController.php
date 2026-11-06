<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\InventoryItem;
use Illuminate\Http\Request;

class InventoryController extends Controller
{
    public function index()
    {
        return response()->json(InventoryItem::with('restaurant')->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'integer'],
            'name' => ['required', 'string', 'max:255'],
            'quantity' => ['required', 'integer', 'min:0'],
            'unit' => ['nullable', 'string', 'max:50'],
            'alert_level' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'string', 'max:50'],
        ]);
        $validated = $this->assignRestaurant($validated, $request);

        $inventoryItem = InventoryItem::create($validated);

        return response()->json($inventoryItem, 201);
    }

    public function show(InventoryItem $inventoryItem)
    {
        return response()->json($inventoryItem->load('restaurant'));
    }

    public function update(Request $request, InventoryItem $inventoryItem)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'exists:restaurants,id'],
            'name' => ['sometimes', 'string', 'max:255'],
            'quantity' => ['sometimes', 'integer', 'min:0'],
            'unit' => ['nullable', 'string', 'max:50'],
            'alert_level' => ['nullable', 'integer', 'min:0'],
            'status' => ['nullable', 'string', 'max:50'],
        ]);

        $inventoryItem->update($validated);

        return response()->json($inventoryItem);
    }

    public function destroy(InventoryItem $inventoryItem)
    {
        $inventoryItem->delete();

        return response()->json(null, 204);
    }
}
