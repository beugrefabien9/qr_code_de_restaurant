<?php

namespace App\Models\Concerns;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;

trait BelongsToRestaurant
{
    protected static function bootBelongsToRestaurant(): void
    {
        static::addGlobalScope('restaurant', function (Builder $builder): void {
            $user = Auth::user();
            $restaurantId = $user?->restaurant_id;

            if ($restaurantId) {
                $builder->where($builder->getModel()->qualifyColumn('restaurant_id'), $restaurantId);
            } elseif ($user && $user->role !== 'admin') {
                $builder->whereRaw('1 = 0');
            }
        });

        static::creating(function ($model): void {
            $restaurantId = Auth::user()?->restaurant_id;

            if (! $restaurantId) {
                return;
            }

            if ($model->restaurant_id && (int) $model->restaurant_id !== (int) $restaurantId) {
                abort(403, 'Vous ne pouvez pas accéder aux données d’un autre restaurant.');
            }

            $model->restaurant_id = $restaurantId;
        });

        static::updating(function ($model): void {
            $restaurantId = Auth::user()?->restaurant_id;

            if ($restaurantId && (int) $model->restaurant_id !== (int) $restaurantId) {
                abort(403, 'Vous ne pouvez pas modifier les données d’un autre restaurant.');
            }
        });
    }
}
