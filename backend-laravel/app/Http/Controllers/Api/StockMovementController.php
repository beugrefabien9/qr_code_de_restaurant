<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\StockMovement;
use Illuminate\Http\Request;

class StockMovementController extends Controller
{
    public function index()
    {
        return response()->json(StockMovement::with('ingredient')->latest()->limit(20)->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'integer'],
            'ingredient_id' => ['required', $this->restaurantResourceRule('ingredients', $request)],
            'movement_type' => ['required', 'string', 'max:50'],
            'source' => ['nullable', 'string', 'max:100'],
            'quantity' => ['required', 'numeric', 'min:0'],
            'notes' => ['nullable', 'string'],
        ]);
        $validated = $this->assignRestaurant($validated, $request);

        $movement = StockMovement::create($validated);

        return response()->json($movement->load(['restaurant', 'ingredient']), 201);
    }

    public function show(StockMovement $stockMovement)
    {
        return response()->json($stockMovement->load(['restaurant', 'ingredient']));
    }

    public function update(Request $request, StockMovement $stockMovement)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'exists:restaurants,id'],
            'ingredient_id' => ['sometimes', $this->restaurantResourceRule('ingredients', $request)],
            'movement_type' => ['sometimes', 'string', 'max:50'],
            'source' => ['nullable', 'string', 'max:100'],
            'quantity' => ['sometimes', 'numeric', 'min:0'],
            'notes' => ['nullable', 'string'],
        ]);

        $stockMovement->update($validated);

        return response()->json($stockMovement->fresh(['restaurant', 'ingredient']));
    }

    public function destroy(StockMovement $stockMovement)
    {
        $stockMovement->delete();

        return response()->json(null, 204);
    }
}
