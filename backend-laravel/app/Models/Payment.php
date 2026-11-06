<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Auth;

class Payment extends Model
{
    use HasFactory;

    protected static function booted(): void
    {
        static::addGlobalScope('restaurant', function (Builder $builder): void {
            $restaurantId = Auth::user()?->restaurant_id;

            if ($restaurantId) {
                $builder->whereHas('order', fn (Builder $query) => $query->where('restaurant_id', $restaurantId));
            }
        });

        static::saving(function (self $payment): void {
            $restaurantId = Auth::user()?->restaurant_id;

            if ($restaurantId && ! Order::whereKey($payment->order_id)->exists()) {
                abort(403, 'Vous ne pouvez pas accéder aux paiements d’un autre restaurant.');
            }
        });
    }

    protected $fillable = [
        'order_id',
        'amount',
        'payment_method',
        'status',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}
