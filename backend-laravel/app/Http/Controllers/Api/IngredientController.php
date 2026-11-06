<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Ingredient;
use Illuminate\Http\Request;

class IngredientController extends Controller
{
    private function serializeIngredient(Ingredient $ingredient): array
    {
        $isLowStock = (float) $ingredient->current_stock <= (float) ($ingredient->alert_threshold ?? 0);

        return [
            'id' => $ingredient->id,
            'restaurant_id' => $ingredient->restaurant_id,
            'name' => $ingredient->name,
            'unit' => $ingredient->unit ?? 'kg',
            'current_stock' => (float) $ingredient->current_stock,
            'alert_threshold' => (float) ($ingredient->alert_threshold ?? 0),
            'is_low_stock' => (bool) $isLowStock,
            'created_at' => $ingredient->created_at,
            'updated_at' => $ingredient->updated_at,
        ];
    }

    public function index()
    {
        return response()->json(Ingredient::query()->get()->map(fn (Ingredient $ingredient) => $this->serializeIngredient($ingredient)));
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'integer'],
            'name' => ['required', 'string', 'max:255'],
            'unit' => ['nullable', 'string', 'max:50'],
            'current_stock' => ['required', 'numeric', 'min:0'],
            'alert_threshold' => ['nullable', 'numeric', 'min:0'],
            'is_low_stock' => ['nullable', 'boolean'],
        ]);
        $validated = $this->assignRestaurant($validated, $request);

        $ingredient = Ingredient::create($validated);

        return response()->json($this->serializeIngredient($ingredient->fresh()), 201);
    }

    public function show(Ingredient $ingredient)
    {
        return response()->json($this->serializeIngredient($ingredient->load('restaurant')));
    }

    public function update(Request $request, Ingredient $ingredient)
    {
        $validated = $request->validate([
            'restaurant_id' => ['sometimes', 'exists:restaurants,id'],
            'name' => ['sometimes', 'string', 'max:255'],
            'unit' => ['nullable', 'string', 'max:50'],
            'current_stock' => ['sometimes', 'numeric', 'min:0'],
            'alert_threshold' => ['nullable', 'numeric', 'min:0'],
            'is_low_stock' => ['nullable', 'boolean'],
        ]);

        $ingredient->update($validated);

        return response()->json($this->serializeIngredient($ingredient->fresh()));
    }

    public function destroy(Ingredient $ingredient)
    {
        $ingredient->delete();

        return response()->json(null, 204);
    }
}
