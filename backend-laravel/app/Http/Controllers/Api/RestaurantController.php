<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Restaurant;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class RestaurantController extends Controller
{
    public function index(Request $request)
    {
        $restaurants = Restaurant::with(['tables', 'products', 'orders'])
            ->when(
                ! $request->user()->isGlobalAdmin(),
                fn ($query) => $query->whereKey($request->user()->restaurant_id),
            )
            ->get();

        return response()->json($restaurants);
    }

    public function store(Request $request)
    {
        return response()->json(['message' => 'Un compte partenaire ne peut gérer qu’un seul restaurant.'], 403);
    }

    public function show(Request $request, Restaurant $restaurant)
    {
        abort_unless(
            $request->user()->isGlobalAdmin()
                || (int) $restaurant->id === (int) $request->user()->restaurant_id,
            404,
        );

        return response()->json($restaurant->load(['tables', 'products', 'orders']));
    }

    public function update(Request $request, Restaurant $restaurant)
    {
        abort_unless(
            $request->user()->isGlobalAdmin()
                || (int) $restaurant->id === (int) $request->user()->restaurant_id,
            404,
        );

        abort_if(
            $request->exists('status'),
            422,
            'Le statut du restaurant doit être modifié depuis les actions administrateur dédiées.',
        );

        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:255'],
            'address' => ['nullable', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:50'],
            'email' => ['nullable', 'email', Rule::unique('restaurants', 'email')->ignore($restaurant->id)],
            'city' => ['nullable', 'string', 'max:100'],
        ]);

        $restaurant->update($validated);

        return response()->json($restaurant);
    }

    public function destroy(Request $request, Restaurant $restaurant)
    {
        abort_unless(
            $request->user()->isGlobalAdmin()
                || (int) $restaurant->id === (int) $request->user()->restaurant_id,
            404,
        );

        $restaurant->delete();

        return response()->json(null, 204);
    }
}
