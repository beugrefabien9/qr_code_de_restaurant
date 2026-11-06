<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

abstract class Controller
{
    protected function assignRestaurant(array $attributes, Request $request): array
    {
        $user = $request->user();
        $restaurantId = $user->restaurant_id;

        if ($user->isGlobalAdmin()) {
            $restaurantId = $attributes['restaurant_id'] ?? null;
            abort_unless(
                $restaurantId && DB::table('restaurants')->where('id', $restaurantId)->exists(),
                422,
                'Sélectionnez un restaurant existant pour cette opération.',
            );
            $attributes['restaurant_id'] = $restaurantId;

            return $attributes;
        }

        abort_unless($restaurantId, 403, 'Aucun restaurant n’est associé à ce compte.');

        if (isset($attributes['restaurant_id']) && (int) $attributes['restaurant_id'] !== (int) $restaurantId) {
            abort(403, 'Vous ne pouvez pas accéder aux données d’un autre restaurant.');
        }

        $attributes['restaurant_id'] = $restaurantId;

        return $attributes;
    }

    protected function restaurantResourceRule(string $table, Request $request)
    {
        $rule = Rule::exists($table, 'id');
        $restaurantId = $request->user()->restaurant_id ?? $request->input('restaurant_id');

        if ($restaurantId) {
            $rule->where('restaurant_id', $restaurantId);
        }

        return $rule;
    }
}
